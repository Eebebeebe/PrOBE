import EventEmitter from 'eventemitter3'
import {
    BlueprintInsertPlan,
    IBlueprint,
    IIcon,
    IEntity,
    InventoryPosition,
    IPoint,
    ISchedule,
    ScheduleData,
    LogisticFilter,
    LogisticSection,
    LogisticSections,
    SignalType,
} from '../types'
import util from '../common/util'
import FD, { getEntitySize, getModuleInventoryIndex, hasModuleFunctionality } from './factorioData'
import { Entity } from './Entity'
import { WireConnections } from './WireConnections'
import { PositionGrid } from './PositionGrid'
import * as generators from './generators'
import { IVisualization } from './generators'
import { History } from './History'
import { Tile } from './Tile'
import { need } from './need'
import { getFactorioVersion } from './factorioVersion'
import { coreSettings } from './config'

export interface IOilOutpostSettings extends Record<string, string | boolean | number> {
    DEBUG: boolean
    PUMPJACK_MODULE: string
    MIN_GAP_BETWEEN_UNDERGROUNDS: number
    BEACONS: boolean
    MIN_AFFECTED_ENTITIES: number
    BEACON_MODULE: string
}

const oilOutpostSettings: IOilOutpostSettings = {
    DEBUG: false,
    PUMPJACK_MODULE: 'productivity-module-3',
    MIN_GAP_BETWEEN_UNDERGROUNDS: 1,
    BEACONS: true,
    MIN_AFFECTED_ENTITIES: 1,
    BEACON_MODULE: 'speed-module-3',
}

class OurMap<K, V> extends Map<K, V> {
    // The two arguments only ever make sense together - there is no key without
    // a key function - which the overloads say and a pair of optionals did not.
    public constructor()
    public constructor(values: V[], mapFn: (value: V) => K)
    public constructor(values?: V[], mapFn?: (value: V) => K) {
        if (values !== undefined && mapFn !== undefined) {
            super(values.map(e => [mapFn(e), e]))
        } else {
            super()
        }
    }

    public isEmpty(): boolean {
        return this.size === 0
    }

    public valuesArray(): V[] {
        return [...this.values()]
    }

    public find(predicate: (value: V, key: K) => boolean): V | undefined {
        for (const [k, v] of this) {
            if (predicate(v, k)) return v
        }
        return undefined
    }

    public filter(predicate: (value: V, key: K) => boolean): V[] {
        const result: V[] = []
        for (const [k, v] of this) {
            if (predicate(v, k)) {
                result.push(v)
            }
        }
        return result
    }
}

interface IEntityData extends Omit<IEntity, 'entity_number'> {
    entity_number?: number
}

export interface BlueprintEvents {
    'create-entity': [entity: Entity]
    'remove-entity': []
    'create-tile': [tile: Tile]
    /** Fired by generatePipes when oilOutpostSettings.DEBUG is on: the generators' search paths, for a renderer to draw. */
    'generate-pipes-debug': [visualizations: IVisualization[][]]
}

/** Blueprint base class */
/** Top-level blueprint fields Blueprint models; every other field is carried verbatim. */
const MODELLED_FIELDS = new Set([
    'version',
    'item',
    'icons',
    'label',
    'description',
    'entities',
    'tiles',
    'wires',
    'schedules',
    'absolute-snapping',
    'snap-to-grid',
    'position-relative-to-grid',
])

class Blueprint extends EventEmitter<BlueprintEvents> {
    /** The label as loaded or set; undefined for an unlabelled blueprint. */
    private label?: string
    /*
        Fields the editor does not model - `parameters` of parametrised
        blueprints, `stock_connections` of trains, anything a newer game version
        adds - kept as they came in so a save does not drop them.
    */
    private readonly unmodelled: Record<string, unknown> = {}
    /** The icons as loaded, written back unchanged (type and quality included). */
    private readonly loadedIcons?: IIcon[]
    private readonly icons = new Map<1 | 2 | 3 | 4, string>()
    public readonly wireConnections = new WireConnections(this)
    public readonly entityPositionGrid = new PositionGrid(this)
    public readonly entities = new OurMap<number, Entity>()
    public readonly tiles = new OurMap<string, Tile>()
    public readonly history = new History()

    // unused blueprint properties
    private readonly description?: string
    /*
        Boxed, unlike its neighbours, because it is the one of them that changes:
        `setSchedule` rewrites it when a locomotive is pasted onto (issue #115),
        and that goes through `history` so it undoes with everything else.
        `History.updateValue` takes an object and a key, and `keyof this` never
        includes a private member, so handing it `this` does not type check and
        casting around that would mean asserting a lie about the class. A box it
        can address honestly is cheaper than either.

        Still carried verbatim in every other respect - the editor has no schedule
        editor, and nothing reads the contents.
    */
    private readonly scheduleStore: { schedules?: ISchedule[] } = {}
    private readonly absolute_snapping?: boolean
    private readonly snap_to_grid?: IPoint
    private readonly position_relative_to_grid?: IPoint

    private m_nextEntityNumber = 1

    public constructor(data?: Partial<IBlueprint>) {
        super()

        if (data) {
            if (data.label) {
                this.label = data.label
            }

            for (const [key, value] of Object.entries(data)) {
                if (!MODELLED_FIELDS.has(key)) this.unmodelled[key] = value
            }

            if (data.icons && data.icons.length) {
                this.loadedIcons = data.icons
            }

            if (data.icons) {
                for (const icon of data.icons) {
                    if (!icon.signal.name) continue
                    this.icons.set(icon.index, icon.signal.name)
                }
            }

            const offset = getOffset(data)

            if (data.tiles) {
                this.tiles = new OurMap(
                    data.tiles.map(
                        tile =>
                            new Tile(
                                tile.name,
                                Math.floor(tile.position.x + offset.x) + 0.5,
                                Math.floor(tile.position.y + offset.y) + 0.5
                            )
                    ),
                    t => t.hash
                )
            }

            if (data.entities !== undefined) {
                const pre_2_0 =
                    data.version !== undefined && data.version < getFactorioVersion(2, 0, 0)
                const dirMult = pre_2_0 ? 2 : 1

                this.m_nextEntityNumber =
                    data.entities.reduce((acc, e) => Math.max(acc, e.entity_number), 0) + 1

                this.history.startTransaction()

                if (pre_2_0) {
                    for (const e of data.entities) {
                        this.wireConnections.createEntityConnections(
                            e.entity_number,
                            e.connections,
                            e.neighbours
                        )
                        delete e.connections
                        delete e.neighbours
                    }
                } else if (data.wires) {
                    this.wireConnections.createBpConnections(data.wires)
                    delete data.wires
                }

                this.entities = new OurMap(
                    data.entities.map(e => {
                        const direction = (e.direction || 0) * dirMult
                        /*
                            Off-grid entities (land mines, locomotives, wagons,
                            cargo pods) keep their exact position. They used to be
                            snapped to the tile grid here, and the snapped position
                            was what serialize() wrote back: land mines moved by up
                            to half a tile, and wagons - whose facing is an
                            `orientation`, not the `direction` the snap rotated
                            by - by half a tile off their rails. PositionGrid
                            already rounds every footprint to whole cells, so the
                            grid itself needs no snapped position.
                        */
                        const position = util.sumprod(e.position, offset)
                        if (pre_2_0 && e.name === 'straight-rail') {
                            e.name = 'legacy-straight-rail'
                        }
                        let items: BlueprintInsertPlan[] | undefined
                        if (e.items) {
                            if (!Array.isArray(e.items)) {
                                if (!pre_2_0) {
                                    throw new Error('Items is object but bp is not pre 2.0')
                                }
                                items = []
                                let stack = 0
                                for (const [name, count] of Object.entries(e.items)) {
                                    const item = FD.items[name]
                                    if (!item) continue
                                    if (item.type === 'module') {
                                        const inventory = getModuleInventoryIndex(
                                            FD.entities[e.name]
                                        )
                                        if (!inventory) {
                                            throw new Error("Can't find inventory index!")
                                        }
                                        const in_inventory: InventoryPosition[] = []
                                        for (let i = 0; i < count; i++) {
                                            in_inventory.push({
                                                inventory,
                                                stack,
                                            })
                                            stack += 1
                                        }
                                        items.push({
                                            id: { name },
                                            items: { in_inventory },
                                        })
                                    } else {
                                        throw new Error("Can't map item to new format!")
                                    }
                                }
                            } else {
                                items = e.items
                            }
                        }
                        if (
                            e.parameters &&
                            e.parameters.playback_globally !== undefined &&
                            !e.parameters.playback_mode
                        ) {
                            e.parameters.playback_mode = e.parameters.playback_globally
                                ? 'global'
                                : 'local'
                            delete e.parameters.playback_globally
                        }
                        if (
                            e.control_behavior &&
                            e.control_behavior.read_logistics !== undefined &&
                            !e.control_behavior.read_items_mode
                        ) {
                            e.control_behavior.read_items_mode = e.control_behavior.read_logistics
                                ? FD.defines.control_behavior.roboport.read_items_mode.logistics
                                : FD.defines.control_behavior.roboport.read_items_mode.none
                            delete e.control_behavior.read_logistics
                        }
                        if (
                            e.control_behavior &&
                            e.control_behavior.filters !== undefined &&
                            !e.control_behavior.sections
                        ) {
                            const filters: LogisticFilter[] = e.control_behavior.filters.map(f => ({
                                index: f.index,
                                type: f.signal.type,
                                name: f.signal.name,
                                count: f.count,
                            }))
                            const section: LogisticSection = { index: 1, filters }
                            e.control_behavior.sections = { sections: [section] }
                            delete e.control_behavior.filters
                        }
                        if (
                            e.control_behavior &&
                            e.control_behavior.circuit_enable_disable !== undefined &&
                            e.control_behavior.circuit_enabled === undefined
                        ) {
                            e.control_behavior.circuit_enabled =
                                e.control_behavior.circuit_enable_disable
                            delete e.control_behavior.circuit_enable_disable
                        }
                        if (
                            e.control_behavior &&
                            e.control_behavior.decider_conditions !== undefined &&
                            e.control_behavior.decider_conditions.conditions === undefined &&
                            e.control_behavior.decider_conditions.outputs === undefined
                        ) {
                            const c = e.control_behavior.decider_conditions
                            c.conditions = [
                                {
                                    comparator: c.comparator,
                                    constant: c.constant,
                                    first_signal: c.first_signal,
                                    first_signal_networks: c.first_signal_networks,
                                    second_signal: c.second_signal,
                                    second_signal_networks: c.second_signal_networks,
                                },
                            ]
                            c.outputs =
                                c.output_signal === undefined
                                    ? []
                                    : [
                                          {
                                              signal: c.output_signal,
                                              copy_count_from_input: c.copy_count_from_input,
                                          },
                                      ]
                            delete c.comparator
                            delete c.constant
                            delete c.copy_count_from_input
                            delete c.first_signal
                            delete c.first_signal_networks
                            delete c.second_signal
                            delete c.second_signal_networks
                            delete c.output_signal
                        }
                        if (typeof e.filter === 'string') {
                            e.filter = { name: e.filter }
                        }
                        if (
                            e.auto_launch !== undefined &&
                            e.launch_to_orbit_automatically === undefined
                        ) {
                            e.launch_to_orbit_automatically = e.auto_launch
                            delete e.auto_launch
                        }
                        if (
                            (e.request_filters !== undefined && Array.isArray(e.request_filters)) ||
                            e.request_from_buffers !== undefined
                        ) {
                            if (!pre_2_0) {
                                throw new Error('request_filters is array but bp is not pre 2.0')
                            }
                            const out: LogisticSections = {
                                request_from_buffers: e.request_from_buffers,
                            }
                            delete e.request_from_buffers
                            if (Array.isArray(e.request_filters)) {
                                const filters: LogisticFilter[] = e.request_filters.map(f => ({
                                    index: f.index,
                                    name: f.name,
                                    count: f.count === undefined ? 1 : f.count,
                                }))
                                /*
                                    1, not 0: every section Factorio writes is
                                    numbered from 1 - measured over the corpus,
                                    all 6017 request_filters sections are at 1,
                                    2 or 3 and all 1344 control_behavior ones run
                                    1 to 15. Nothing in this editor could see
                                    the difference, since every reader indexes
                                    the array positionally rather than by the
                                    section's own index, so a 0 round-tripped
                                    here perfectly and showed up only in the
                                    game (issue #89).
                                */
                                const section: LogisticSection = { index: 1, filters }
                                out.sections = [section]
                            }
                            e.request_filters = out
                        }

                        return this.createEntity({
                            ...e,
                            direction,
                            position,
                            items,
                        })
                    }),
                    e => e.entityNumber
                )

                if (data.version !== undefined && data.version < getFactorioVersion(1, 1, 11)) {
                    this.wireConnections.generatePowerPoleWires()
                }

                this.history.commitTransaction()
            }

            this.description = data.description
            this.scheduleStore.schedules = data.schedules
            this.absolute_snapping = data['absolute-snapping']
            this.snap_to_grid = data['snap-to-grid']
            this.position_relative_to_grid = data['position-relative-to-grid']
        }

        // makes initial entities non undoable and resets the history if the user cleared the editor
        this.history.reset()
        this.history.logging = coreSettings.debug

        return this
    }

    public createEntity(rawData: IEntityData, connectPowerPole = false): Entity {
        const rawEntity = new Entity(
            {
                ...rawData,
                entity_number: rawData.entity_number
                    ? rawData.entity_number
                    : this.nextEntityNumber,
            },
            this
        )

        this.history
            .updateMap(this.entities, rawEntity.entityNumber, rawEntity, 'Create entity')
            .onDone(this.onCreateOrRemoveEntity.bind(this))
            .commit()

        if (connectPowerPole) this.wireConnections.connectPowerPole(rawEntity.entityNumber)

        return rawEntity
    }

    public removeEntity(entity: Entity): void {
        this.history.startTransaction('Remove entity')

        this.wireConnections.removeEntityConnections(entity.entityNumber)

        this.history
            .updateMap(this.entities, entity.entityNumber, undefined, 'Remove entity')
            .onDone(this.onCreateOrRemoveEntity.bind(this))
            .commit()

        this.history.commitTransaction()
    }

    public removeEntities(entities: Entity[]): void {
        this.history.startTransaction('Remove entities')
        for (const e of entities) {
            this.removeEntity(e)
        }
        this.history.commitTransaction()
    }

    public fastReplaceEntity(name: string, direction: number, position: IPoint): boolean {
        const entity = this.entityPositionGrid.checkFastReplaceableGroup(name, direction, position)

        if (!entity) return false

        this.history.startTransaction('Fast replace entity')

        const connections = this.wireConnections.getEntityConnections(entity.entityNumber)

        this.removeEntity(entity)

        this.createEntity({
            name,
            direction,
            position: entity.position,
            entity_number: entity.entityNumber,
        }).pasteSettings(entity)

        for (const conn of connections) {
            this.wireConnections.create(conn)
        }

        this.history.commitTransaction()

        return true
    }

    private onCreateOrRemoveEntity(
        newValue: Entity | undefined,
        oldValue: Entity | undefined
    ): void {
        if (newValue) {
            this.entityPositionGrid.setTileData(newValue)
            this.emit('create-entity', newValue)
        } else if (oldValue) {
            this.entityPositionGrid.removeTileData(oldValue)
            oldValue.destroy()
            this.emit('remove-entity')
        }
    }

    public createTiles(name: string, positions: IPoint[]): void {
        this.history.startTransaction('Create tiles')

        for (const p of positions) {
            const tile = new Tile(name, p.x, p.y)
            this.history
                .updateMap(this.tiles, tile.hash, tile, 'Create tile')
                .onDone(this.onCreateOrRemoveTile.bind(this))
                .commit()
        }

        this.history.commitTransaction()
    }

    public removeTiles(positions: IPoint[]): void {
        this.history.startTransaction('Remove tiles')

        positions
            .map(p => this.tiles.get(`${p.x},${p.y}`))
            .filter(tile => !!tile)
            .forEach(tile => {
                this.history
                    .updateMap(this.tiles, tile.hash, undefined, 'Remove tile')
                    .onDone(this.onCreateOrRemoveTile.bind(this))
                    .commit()
            })

        this.history.commitTransaction()
    }

    private onCreateOrRemoveTile(newValue: Tile | undefined, oldValue: Tile | undefined): void {
        if (oldValue) {
            oldValue.destroy()
        }

        if (newValue) {
            this.emit('create-tile', newValue)
        }
    }

    private get nextEntityNumber(): number {
        const nr = this.m_nextEntityNumber
        this.m_nextEntityNumber += 1
        return nr
    }

    public getFirstRailRelatedEntityPos(): IPoint | undefined {
        for (const [, e] of this.entities) {
            switch (e.type) {
                case 'legacy-straight-rail':
                case 'straight-rail':
                case 'half-diagonal-rail':
                case 'curved-rail-a':
                case 'curved-rail-b':
                case 'train-stop':
                    return e.position
                case 'legacy-curved-rail':
                    return { x: e.position.x - 1, y: e.position.y - 1 }
            }
        }
        return undefined
    }

    public isEmpty(): boolean {
        return this.entities.isEmpty() && this.tiles.isEmpty()
    }

    /**
     * The centre that serialize() re-bases positions on, in whole tiles - and
     * in even tiles while the blueprint holds anything on the 2x2 rail grid, so
     * re-basing never moves a rail off its grid (see railGridStep).
     */
    private getCenter(): IPoint {
        if (this.isEmpty()) return { x: 0, y: 0 }
        const step = railGridStep(this.entities.valuesArray().map(e => e.name))

        const data = [
            ...this.entities
                .valuesArray()
                .map(e => ({ x: e.position.x, y: e.position.y, w: e.size.x, h: e.size.y })),
            ...this.tiles.valuesArray().map(t => ({ x: t.x, y: t.y, w: 1, h: 1 })),
        ]

        const minX = data.reduce((min, d) => Math.min(min, d.x - d.w / 2), Infinity)
        const minY = data.reduce((min, d) => Math.min(min, d.y - d.h / 2), Infinity)
        const maxX = data.reduce((max, d) => Math.max(max, d.x + d.w / 2), -Infinity)
        const maxY = data.reduce((max, d) => Math.max(max, d.y + d.h / 2), -Infinity)

        return {
            x: step * Math.round((minX + maxX) / 2 / step),
            y: step * Math.round((minY + maxY) / 2 / step),
        }
    }

    public generatePipes(): string | undefined {
        const {
            DEBUG,
            PUMPJACK_MODULE,
            MIN_GAP_BETWEEN_UNDERGROUNDS,
            MIN_AFFECTED_ENTITIES,
            BEACON_MODULE,
            BEACONS,
        } = oilOutpostSettings

        const pumpjacks = this.entities
            .filter(v => v.name === 'pumpjack')
            .map(p => ({ entity_number: p.entityNumber, name: p.name, position: p.position }))

        if (pumpjacks.length < 2 || pumpjacks.length > 200) {
            return 'There should be between 2 and 200 pumpjacks in the blueprint area!'
        }

        if (pumpjacks.length !== this.entities.size) {
            return 'Blueprint area should only contain pumpjacks!'
        }

        const visualizations: IVisualization[][] = []

        coreSettings.logger.log('Generating pipes...')

        // The generator timers report through the core logger too.
        const logTimer = (...data: unknown[]): void => coreSettings.logger.log(...data)
        const T = util.timer('Total generation', logTimer)

        // Generate pipes
        const GPT = util.timer('Pipe generation', logTimer)

        // I wrapped generatePipes into a Web Worker but for some reason it sometimes takes x2 time to run the function
        // Usualy when there are more than 100 pumpjacks the function will block the main thread
        // which is not great but the user should wait for the generated entities anyway
        const GP = generators.generatePipes(pumpjacks, MIN_GAP_BETWEEN_UNDERGROUNDS)
        visualizations.push(GP.visualizations)

        coreSettings.logger.log('Pipes:', GP.info.nrOfPipes)
        coreSettings.logger.log('Underground Pipes:', GP.info.nrOfUPipes)
        coreSettings.logger.log(
            'Pipes replaced by underground pipes:',
            GP.info.nrOfPipesReplacedByUPipes
        )
        coreSettings.logger.log(
            'Ratio (pipes replaced/underground pipes):',
            GP.info.nrOfPipesReplacedByUPipes / GP.info.nrOfUPipes
        )
        GPT.stop()

        // Generate beacons
        let beacons: {
            name: string
            position: IPoint
        }[] = []
        if (BEACONS) {
            const GBT = util.timer('Beacon generation', logTimer)

            const entitiesForBeaconGen = [
                ...pumpjacks.map(p => ({ ...p, size: 3, effect: true })),
                ...GP.pipes.map(p => ({ ...p, size: 1, effect: false })),
            ]

            const GB = generators.generateBeacons(entitiesForBeaconGen, MIN_AFFECTED_ENTITIES)
            beacons = GB.beacons
            visualizations.push(GB.visualizations)

            if (BEACONS) {
                coreSettings.logger.log('Beacons:', GB.info.totalBeacons)
                coreSettings.logger.log('Effects given by beacons:', GB.info.effectsGiven)
            }

            GBT.stop()
        }

        // Generate poles
        const GPOT = util.timer('Pole generation', logTimer)

        const entitiesForPoleGen = [
            ...pumpjacks.map(p => ({ ...p, size: 3, power: true })),
            ...GP.pipes.map(p => ({ ...p, size: 1, power: false })),
            ...beacons.map(p => ({ ...p, size: 3, power: true })),
        ]

        const GPO = generators.generatePoles(entitiesForPoleGen)
        visualizations.push(GPO.visualizations)

        coreSettings.logger.log('Power Poles:', GPO.info.totalPoles)
        GPOT.stop()

        T.stop()

        // Apply Changes
        this.history.logging = false
        this.history.startTransaction('Generate Oil Outpost')

        for (const pipe of GP.pipes) {
            this.createEntity(pipe)
        }
        const e = FD.entities['beacon']
        const inventory = getModuleInventoryIndex(e)
        if (inventory === null) {
            throw new Error('beacon has no module inventory')
        }
        const beacon_module_slots = (hasModuleFunctionality(e) && e.module_slots) || 0
        const items: BlueprintInsertPlan[] = []
        const in_inventory: InventoryPosition[] = []
        for (let i = 0; i < beacon_module_slots; i++) {
            in_inventory.push({
                inventory,
                stack: i,
            })
        }
        items.push({
            id: { name: BEACON_MODULE },
            items: { in_inventory },
        })
        for (const beacon of beacons) {
            this.createEntity({
                ...beacon,
                items,
            })
        }
        for (const pole of GPO.poles) {
            this.createEntity(pole)
        }

        this.wireConnections.generatePowerPoleWires()

        for (const p of GP.pumpjacksToRotate) {
            // Created by this same method a few lines up, so its absence would
            // mean the generator returned a number we never placed.
            const entity = this.entities.get(p.entity_number)
            if (entity === undefined) {
                throw new Error(`generator returned unknown entity ${p.entity_number}`)
            }
            entity.direction = p.direction
            if (PUMPJACK_MODULE !== 'none') {
                entity.modules = Array.from<string>({ length: entity.moduleSlots }).fill(
                    PUMPJACK_MODULE
                )
            }
        }

        this.history.commitTransaction()
        this.history.logging = true

        // Hand the generators' search paths to whoever draws them (BlueprintContainer).
        if (DEBUG) this.emit('generate-pipes-debug', visualizations)
    }

    /** behaves like in Factorio 0.17.14 */
    private generateIcons(): void {
        /** returns [iconName, count][] */
        const getIconPairs = (
            tilesOrEntities: (Tile | Entity)[],
            getItemName: (name: string) => string | undefined
        ): [string, number][] => [
            ...tilesOrEntities.reduce<Map<string, number>>((map, tileOrEntity) => {
                const itemName = getItemName(tileOrEntity.name)
                // nothing to show for an entity that cannot be mined into an item
                if (itemName === undefined) return map
                const count = map.get(itemName)
                return map.set(itemName, count === undefined ? 0 : count + 1)
            }, new Map()),
        ]

        if (!this.entities.isEmpty()) {
            const getSize = (name: string): number => {
                const e_size = getEntitySize(FD.entities[need(FD.items[name], 'place_result')])
                return e_size.x * e_size.y
            }
            const getItemScore = (item: [string, number]): number => getSize(item[0]) * item[1]

            const iconPairs = getIconPairs(this.entities.valuesArray(), Entity.getItemName).sort(
                (a, b) => getItemScore(b) - getItemScore(a)
            )

            this.icons.set(1, iconPairs[0][0])
            if (
                iconPairs[1] &&
                getSize(iconPairs[1][0]) > 1 &&
                getItemScore(iconPairs[1]) * 2.5 > getItemScore(iconPairs[0])
            ) {
                this.icons.set(2, iconPairs[1][0])
            }
        } else if (!this.tiles.isEmpty()) {
            const iconPairs = getIconPairs(this.tiles.valuesArray(), Tile.getItemName).sort(
                (a, b) => b[1] - a[1]
            )

            this.icons.set(1, iconPairs[0][0])
        }
    }

    /**
     * The schedule the locomotive with this entity number is on, or undefined for
     * one that is on none.
     *
     * A schedule lives on the blueprint rather than on the entity - `schedules` is
     * a top-level list of `{locomotives, schedule}` - so this is the only way an
     * `Entity` can reach its own.
     */
    public getSchedule(entityNumber: number): ScheduleData | undefined {
        return this.scheduleStore.schedules?.find(s => s.locomotives.includes(entityNumber))
            ?.schedule
    }

    /**
     * Puts a locomotive on `schedule`, or takes it off whatever it was on when
     * that is undefined.
     *
     * Three behaviours here are measured rather than chosen, from
     * `tools/oracle/fixtures/copy-settings-schedule.json`:
     *
     * - it **replaces**. A locomotive already on a schedule is taken off that one
     *   first, so nothing merges.
     * - **undefined clears**, and is a real case rather than a no-op: the game's
     *   own copy from a locomotive with no schedule empties the target's, and the
     *   resulting blueprint has no `schedules` key at all.
     * - locomotives holding the **same** schedule share one entry, the way the
     *   game writes it, rather than getting one entry each.
     *
     * The sameness test is a JSON compare, which is exact for the case that
     * matters - a paste assigns the source's own schedule object, so the two
     * stringify identically. A separately built but equal schedule whose keys are
     * in another order would get its own entry, which is still valid output.
     */
    public setSchedule(entityNumber: number, schedule: ScheduleData | undefined): void {
        const key = schedule === undefined ? undefined : JSON.stringify(schedule)

        const next = (this.scheduleStore.schedules ?? [])
            .map(s => ({
                ...s,
                locomotives: s.locomotives.filter(n => n !== entityNumber),
            }))
            .filter(s => s.locomotives.length > 0)

        if (key !== undefined) {
            const existing = next.find(s => JSON.stringify(s.schedule) === key)
            if (existing) {
                existing.locomotives = [...existing.locomotives, entityNumber]
            } else {
                next.push({ locomotives: [entityNumber], schedule: schedule as ScheduleData })
            }
        }

        /*
            Absent rather than empty when nothing is left, so a blueprint that has
            had its last schedule removed serializes without the key, the way one
            that never had any does.
        */
        this.history
            .updateValue(
                this.scheduleStore,
                'schedules',
                next.length > 0 ? next : undefined,
                'Change train schedule'
            )
            .commit()
    }

    /** The blueprint's label, or 'Blueprint' for display when it has none. */
    public get name(): string {
        return this.label ?? 'Blueprint'
    }

    public set name(label: string) {
        this.label = label
    }

    public serialize(): IBlueprint {
        if (!this.icons.size) {
            this.generateIcons()
        }
        const entityInfo = this.entities.valuesArray().map(e => e.serialize())
        const wires = this.wireConnections.serializeBpWires()
        // Even on both axes for rail blueprints, so every rail keeps the grid
        // position it was loaded with. This used to force the first rail-like
        // entity onto an odd coordinate, which is only the convention of a
        // straight rail: blueprints led by a curved rail or a train stop moved
        // their rails by one tile on save.
        const center = this.getCenter()

        for (const e of entityInfo) {
            e.position.x -= center.x
            e.position.y -= center.y
        }
        const tileInfo = this.tiles.valuesArray().map(tile => ({
            position: {
                x: Math.floor(tile.x) - Math.floor(center.x),
                y: Math.floor(tile.y) - Math.floor(center.y),
            },
            name: tile.name,
        }))
        const iconData = [...this.icons.entries()].map(([index, icon]) => {
            const getItemTypeForBp = (name: string): SignalType => {
                if (FD.signals[name]) return 'virtual'
                if (FD.fluids[name]) return 'fluid'
                if (FD.recipes[name]) return 'recipe'
                if (FD.entities[name]) return 'entity'
                return 'item'
            }

            return {
                signal: { type: getItemTypeForBp(icon), name: icon },
                index,
            }
        })
        return {
            ...this.unmodelled,
            icons: this.loadedIcons ?? iconData,
            entities: this.entities.isEmpty() ? undefined : entityInfo,
            tiles: this.tiles.isEmpty() ? undefined : tileInfo,
            item: 'blueprint',
            version: getFactorioVersion(),
            label: this.label,
            description: this.description,
            schedules: this.scheduleStore.schedules,
            'absolute-snapping': this.absolute_snapping,
            'snap-to-grid': this.snap_to_grid,
            'position-relative-to-grid': this.position_relative_to_grid,
            wires,
        }
    }
}

function getOffset(data: Partial<IBlueprint>): IPoint {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity

    const comp = (x: number, y: number, w: number, h: number): void => {
        minX = Math.min(minX, x - w / 2)
        minY = Math.min(minY, y - h / 2)
        maxX = Math.max(maxX, x + w / 2)
        maxY = Math.max(maxY, y + h / 2)
    }

    if (data.entities) {
        for (const entity of data.entities) {
            if (FD.entities[entity.name]?.flags?.includes('placeable-off-grid')) continue

            const dirMult =
                data.version !== undefined && data.version < getFactorioVersion(2, 0, 0) ? 2 : 1
            const size = getEntitySize(FD.entities[entity.name], (entity.direction || 0) * dirMult)
            comp(entity.position.x, entity.position.y, size.x, size.y)
        }
    } else if (data.tiles) {
        for (const tile of data.tiles) {
            comp(tile.position.x + 0.5, tile.position.y + 0.5, 1, 1)
        }
    }

    if (minX === Infinity) {
        return { x: 0, y: 0 }
    }

    /*
        A blueprint holding anything on the 2x2 rail grid may only move by an
        even number of whole tiles, or its rails leave their grid. The general
        formula below adds the fractional part of the left edge, which is 0 for
        every ordinary footprint but not for rails, whose footprints are rounded
        from odd collision boxes (a curved rail's is about 1.5 x 5): it moved
        rail blueprints by half tiles.
    */
    if (railGridStep((data.entities ?? []).map(e => e.name)) === 2) {
        return {
            x: -2 * Math.floor((minX + maxX) / 4),
            y: -2 * Math.floor((minY + maxY) / 4),
        }
    }

    // The offset takes into account that the center of the blueprint might be shifted
    return {
        x: -Math.floor((minX + maxX) / 2) + (minX % 1),
        y: -Math.floor((minY + maxY) / 2) + (minY % 1),
    }
}

/** Entity types that sit on the 2x2 rail grid. */
const RAIL_GRID_TYPES = new Set([
    'straight-rail',
    'half-diagonal-rail',
    'curved-rail-a',
    'curved-rail-b',
    'legacy-straight-rail',
    'legacy-curved-rail',
    'elevated-straight-rail',
    'elevated-half-diagonal-rail',
    'elevated-curved-rail-a',
    'elevated-curved-rail-b',
    'rail-ramp',
    'rail-support',
    'train-stop',
])

/**
 * 2 when any of these entities sits on the 2x2 rail grid - a rail of any kind,
 * a train stop, or a prototype declaring `build_grid_size: 2` (the landing
 * pad) - so whole-blueprint moves must be even; 1 otherwise.
 */
function railGridStep(names: Iterable<string>): 1 | 2 {
    for (const name of names) {
        const e = FD.entities[name] as { type: string; build_grid_size?: number } | undefined
        if (e && (RAIL_GRID_TYPES.has(e.type) || e.build_grid_size === 2)) return 2
    }
    return 1
}

export { Blueprint, oilOutpostSettings, getFactorioVersion }
