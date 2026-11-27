import { IPoint } from '../types'
import { Blueprint, railGridStep } from './Blueprint'
import type { Entity } from './Entity'
import { CollisionError, ParityError, PasteConflict } from './errors'
import { IConnection, WireConnections } from './WireConnections'

/*
    Pasting one blueprint into another, the way scripts build an instance:
    `paste(bp, x, y)`. Headless; the editor's own paste preview stays in
    containers/ for now.

    It works like Factorio's paste with three choices on a collision
    (`onConflict`): 'error' - the default - places nothing and says what is in
    the way; 'skip' places what fits and reports the rest; 'replace' removes
    whatever is in the way first. Nothing is replaced unless asked.

    Every entity is checked against the destination as it stands *before*
    anything is placed (the same two-step plan-then-place the editor's own
    paste uses, for the same reason: the pasted entities must not block one
    another), so the outcome does not depend on order and an error leaves the
    destination untouched.

    Power poles connect the way the game connects them, measured in
    tools/oracle/fixtures/pole-paste.json: a pasted pole keeps its blueprint
    wires (a copper wire longer than the reach is dropped) and connects to the
    poles that were there before the paste - never to other poles of the same
    paste. See connectToExistingPoles.
*/

/** What to do where a pasted entity or tile meets something already there. */
export type OnConflict = 'error' | 'skip' | 'replace'

export interface PasteOptions {
    /** Default 'error'. */
    onConflict?: OnConflict
    /** Connect pasted poles to the poles already there, as the game does. Default true. */
    connectPoles?: boolean
}

export interface PasteResult {
    /** The entities the paste created, in the source's entity order. */
    created: Entity[]
    /** Source entity number -> destination entity number, for created entities. */
    entityNumbers: Map<number, number>
    /** What was not placed (onConflict 'skip') or what was removed for it ('replace'). */
    conflicts: PasteConflict[]
}

/** The most copper wires a pole takes; measured (pole-paste.json, case H). */
const MAX_POLE_WIRES = 5

/**
 * Pastes `src` into `dest`, every entity and tile moved by `offset` (whole
 * tiles; even ones when `src` holds anything on the rail grid). One undo step.
 * Throws ParityError for a bad offset and, with onConflict 'error',
 * CollisionError naming what is in the way; in both cases nothing changes.
 */
export function pasteInto(
    dest: Blueprint,
    src: Blueprint,
    offset: IPoint,
    opts: PasteOptions = {}
): PasteResult {
    const onConflict = opts.onConflict ?? 'error'
    const connectPoles = opts.connectPoles ?? true

    if (!Number.isInteger(offset.x) || !Number.isInteger(offset.y)) {
        throw new ParityError(offset, 'it must be in whole tiles')
    }
    const srcEntities = src.entities.valuesArray()
    if (
        railGridStep(srcEntities.map(e => e.name)) === 2 &&
        (offset.x % 2 !== 0 || offset.y % 2 !== 0)
    ) {
        throw new ParityError(offset, 'the blueprint holds rails, which need an even offset')
    }

    const grid = dest.entityPositionGrid
    const at = (p: IPoint): IPoint => ({ x: p.x + offset.x, y: p.y + offset.y })

    /* Plan: every entity and tile against the destination as it is now. */
    const conflicts: PasteConflict[] = []
    const blockers = new Map<number, Entity>()
    const fits: Entity[] = []
    for (const e of srcEntities) {
        const position = at(e.position)
        if (grid.isAreaAvailable(e.name, position, e.direction)) {
            fits.push(e)
            continue
        }
        const inWay = grid.getEntitiesInArea({
            x: position.x,
            y: position.y,
            w: e.size.x,
            h: e.size.y,
        })
        for (const b of inWay) blockers.set(b.entityNumber, b)
        conflicts.push({
            name: e.name,
            position,
            blockedBy:
                inWay.length > 0
                    ? inWay.map(b => `${b.name} at (${b.position.x}, ${b.position.y})`)
                    : ['the rail placement rules'],
        })
        if (onConflict === 'replace' && inWay.length > 0) fits.push(e)
    }
    const tilePlan: { name: string; position: IPoint }[] = []
    const tilesToReplace: IPoint[] = []
    for (const t of src.tiles.values()) {
        const position = at({ x: t.x, y: t.y })
        const there = dest.tiles.get(`${position.x},${position.y}`)
        if (there === undefined) {
            tilePlan.push({ name: t.name, position })
        } else if (there.name !== t.name) {
            conflicts.push({ name: t.name, position, blockedBy: [`tile ${there.name}`] })
            if (onConflict === 'replace') {
                tilesToReplace.push(position)
                tilePlan.push({ name: t.name, position })
            }
        }
    }

    const unresolvable = conflicts.filter(c => c.blockedBy[0] === 'the rail placement rules')
    if (onConflict === 'error' && conflicts.length > 0) throw new CollisionError(conflicts)
    if (onConflict === 'replace' && unresolvable.length > 0) throw new CollisionError(unresolvable)

    /* Place: one transaction. */
    const poleNumbersBefore = new Set(
        dest.entities
            .valuesArray()
            .filter(e => e.type === 'electric-pole')
            .map(e => e.entityNumber)
    )
    const entityNumbers = new Map<number, number>()
    const created: Entity[] = []

    dest.history.startTransaction('Paste blueprint')
    if (onConflict === 'replace') {
        for (const b of blockers.values()) {
            if (dest.entities.has(b.entityNumber)) dest.removeEntity(b)
            poleNumbersBefore.delete(b.entityNumber)
        }
        if (tilesToReplace.length > 0) dest.removeTiles(tilesToReplace)
    }

    for (const e of fits) {
        const ent = dest.createEntity({
            ...e.serialize(),
            entity_number: undefined,
            position: at(e.position),
        })
        entityNumbers.set(e.entityNumber, ent.entityNumber)
        created.push(ent)
        const schedule = src.getSchedule(e.entityNumber)
        if (schedule !== undefined) dest.setSchedule(ent.entityNumber, schedule)
    }

    const byName = new Map<string, IPoint[]>()
    for (const t of tilePlan) byName.set(t.name, [...(byName.get(t.name) ?? []), t.position])
    for (const [name, positions] of byName) dest.createTiles(name, positions)

    copyWires(src, dest, entityNumbers)
    if (connectPoles) connectToExistingPoles(dest, created, poleNumbersBefore)
    dest.history.commitTransaction()

    return { created, entityNumbers, conflicts }
}

/**
 * The source's wires between entities that were both pasted, renumbered. A
 * copper wire longer than its poles reach is dropped, as the game drops it.
 */
function copyWires(src: Blueprint, dest: Blueprint, numbers: Map<number, number>): void {
    const seen = new Set<string>()
    for (const [oldNumber] of numbers) {
        for (const conn of src.wireConnections.getEntityConnections(oldNumber)) {
            const a = numbers.get(conn.cps[0].entityNumber)
            const b = numbers.get(conn.cps[1].entityNumber)
            if (a === undefined || b === undefined) continue
            const copy: IConnection = {
                ...conn,
                cps: [
                    { ...conn.cps[0], entityNumber: a },
                    { ...conn.cps[1], entityNumber: b },
                ],
            }
            const key = JSON.stringify(copy)
            if (seen.has(key)) continue
            seen.add(key)
            if (conn.color === 'copper' && !withinReach(dest, a, b)) continue
            dest.wireConnections.create(copy)
        }
    }
}

function withinReach(bp: Blueprint, a: number, b: number): boolean {
    const ea = bp.entities.get(a)
    const eb = bp.entities.get(b)
    if (!ea || !eb) return false
    return distance(ea.position, eb.position) <= Math.min(ea.maxWireDistance, eb.maxWireDistance)
}

const distance = (a: IPoint, b: IPoint): number => Math.hypot(a.x - b.x, a.y - b.y)

/**
 * Connects each pasted pole to poles that stood there before the paste, by
 * the rule measured in tools/oracle/fixtures/pole-paste.json:
 * candidates within reach (the shorter of the two), nearest first, ties by
 * smaller y then smaller x; a candidate already holding five copper wires is
 * skipped, and so is one the pole already reaches through a neighbour (no
 * wire triangles); a pole stops at five copper wires. Poles of the same paste
 * are not candidates for each other. Pasted poles are handled in the source
 * blueprint's entity order.
 */
function connectToExistingPoles(dest: Blueprint, created: Entity[], existing: Set<number>): void {
    const copperCount = (n: number): number =>
        dest.wireConnections.getEntityConnections(n).filter(c => c.color === 'copper').length
    const copperNeighbours = (n: number): number[] =>
        dest.wireConnections
            .getEntityConnections(n)
            .filter(c => c.color === 'copper')
            .map(c => (c.cps[0].entityNumber === n ? c.cps[1].entityNumber : c.cps[0].entityNumber))

    for (const pole of created) {
        if (pole.type !== 'electric-pole') continue
        const candidates = [...existing]
            .map(n => dest.entities.get(n))
            .filter((e): e is Entity => e !== undefined)
            .filter(
                e =>
                    distance(e.position, pole.position) <=
                    Math.min(e.maxWireDistance, pole.maxWireDistance)
            )
            .sort(
                (a, b) =>
                    distance(a.position, pole.position) - distance(b.position, pole.position) ||
                    a.position.y - b.position.y ||
                    a.position.x - b.position.x
            )
        for (const candidate of candidates) {
            if (copperCount(pole.entityNumber) >= MAX_POLE_WIRES) break
            if (copperCount(candidate.entityNumber) >= MAX_POLE_WIRES) continue
            // No triangles: skip a candidate this pole already reaches in one
            // step or through one of its neighbours - whether that neighbour
            // came with the blueprint (case B) or was connected just now (E).
            // Two steps exactly: iterate the direct neighbours, not the growing set.
            const direct = copperNeighbours(pole.entityNumber)
            const near = new Set<number>(direct)
            for (const n of direct) for (const m of copperNeighbours(n)) near.add(m)
            if (near.has(candidate.entityNumber)) continue
            dest.wireConnections.create(
                WireConnections.toPoleConnection(pole.entityNumber, candidate.entityNumber)
            )
        }
    }
}
