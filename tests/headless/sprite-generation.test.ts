import { beforeAll, describe, expect, it, vi } from 'vite-plus/test'
import { coreSettings } from '../../packages/editor/src/core/config'
import FD from '../../packages/editor/src/core/factorioData'
import { getSpriteData, type IDrawData } from '../../packages/editor/src/core/spriteDataBuilder'
import { EXPECTED_SPRITE_FAILURES } from '../helpers/sprite-expected-failures'
import { loadTestData } from '../helpers/load-test-data'

/*
    The Node twin of the first test in tests/sprite-generation.spec.ts: every
    entity in data.json, facing each cardinal direction, must produce sprites.
    getSpriteData catches a draw_* function that throws, logs "Error generating
    sprites" and draws nothing, so without this a data change can blank a
    whole entity type while everything else stays green. That is how Factorio
    2.1 moving the steam engine, logistic chest and pumpjack graphics went
    unnoticed by the unit tests.

    The input is what the editor's paint preview passes: nothing placed around
    the entity yet, every optional field at its default.
*/
const drawData = (name: string, dir: number, extra: Partial<IDrawData> = {}): IDrawData => ({
    dir,
    name,
    positionGrid: undefined,
    position: { x: 0, y: 0 },
    generateConnector: false,
    displayPanelIcon: undefined,
    assemblerHasFluidInputs: false,
    assemblerHasFluidOutputs: false,
    dirType: undefined,
    selectorCombinatorSelectMax: false,
    operator: undefined,
    railLayer: undefined,
    trainStopColor: undefined,
    modules: [],
    ...extra,
})

const filenames = (name: string, dir: number, extra: Partial<IDrawData> = {}) =>
    getSpriteData(drawData(name, dir, extra)).map(s => s.filename ?? '')

describe('sprite generation in Node', () => {
    beforeAll(loadTestData)

    it('produces sprites for every entity in every cardinal direction', () => {
        const failed = new Set<string>()
        const warn = vi.spyOn(coreSettings.logger, 'warn').mockImplementation((...args) => {
            const m = /Error generating sprites for '([^']+)'/.exec(String(args[0]))
            failed.add(m ? m[1] : `unexpected warning: ${String(args[0])}`)
        })
        try {
            for (const dir of [0, 4, 8, 12]) {
                for (const name of Object.keys(FD.entities)) getSpriteData(drawData(name, dir))
            }
        } finally {
            warn.mockRestore()
        }
        expect([...failed].sort()).toEqual([...EXPECTED_SPRITE_FAILURES].sort())
    })

    it('draws steam engines and turbines from their 2.1 pictures', () => {
        expect(filenames('steam-engine', 0)[0]).toMatch(/steam-engine-V\.png$/)
        expect(filenames('steam-engine', 4)[0]).toMatch(/steam-engine-H\.png$/)
        expect(filenames('steam-turbine', 4)[0]).toMatch(/steam-turbine-H\.png$/)
    })

    it('draws logistic chests from their 2.1 robot door', () => {
        expect(filenames('requester-chest', 0)[0]).toMatch(/logistic-chest\/requester-chest\.png$/)
    })

    it('draws the pumpjack base once per direction, at its own sheet offset', () => {
        for (const [dir, x] of [
            [0, 0],
            [4, 261],
            [8, 522],
            [12, 783],
        ]) {
            const base = getSpriteData(drawData('pumpjack', dir)).filter(s =>
                (s.filename ?? '').endsWith('pumpjack-base.png')
            )
            expect(base.map(s => s.x)).toEqual([x])
        }
    })

    it('draws the 2.1 unloading bay facing each way', () => {
        expect(filenames('landing-pad-unloading-bay', 0)).toContainEqual(
            expect.stringMatching(/extractor-n-4\.png$/)
        )
        expect(filenames('landing-pad-unloading-bay', 4)).toContainEqual(
            expect.stringMatching(/extractor-e-4\.png$/)
        )
    })

    it('draws the pipe covers of an assembler with a fluid recipe', () => {
        const names = filenames('assembling-machine-2', 0, { assemblerHasFluidInputs: true })
        expect(names.some(n => n.endsWith('assembling-machine-2-pipe-N.png'))).toBe(true)
        expect(names.some(n => n.endsWith('assembling-machine-2-pipe-N-shadow.png'))).toBe(true)
    })

    /*
        A known gap, pinned so it cannot be forgotten. Factorio 2.1 replaced the
        cargo bay family's named wall and corner sprites (top_wall,
        bottom_left_outer_corner, ...) with a `tileset` picked through a
        neighbour-mask `tileset_mapping`. getCargoBayConnectionSprites still
        looks the old names up, finds none, and draws no walls - silently, which
        is why it is spelled out here. Fixing it should empty
        the tileset half of this list.
    */
    it('names the cargo-bay connection fields the drawer does not read yet', () => {
        const READ = new Set([
            'top_wall',
            'bottom_wall',
            'left_wall',
            'right_wall',
            'top_left_outer_corner',
            'top_right_outer_corner',
            'bottom_left_outer_corner',
            'bottom_right_outer_corner',
            'top_left_inner_corner',
            'top_right_inner_corner',
            'bottom_left_inner_corner',
            'bottom_right_inner_corner',
        ])
        const unread: string[] = []
        for (const [name, e] of Object.entries(FD.entities)) {
            for (const set of ['graphics_set', 'platform_graphics_set'] as const) {
                const connections = (
                    e as unknown as Record<string, { connections?: object } | undefined>
                )[set]?.connections
                if (!connections) continue
                const keys: string[] = Object.keys(connections)
                for (const key of keys) {
                    if (!READ.has(key)) unread.push(`${name}.${set}.connections.${key}`)
                }
            }
        }
        // tileset / tileset_mapping: new in 2.1, the walls and corners.
        // bridge_*: never read, in 2.0 either - bays drawn side by side show no
        // bridge between them.
        expect(unread.sort()).toEqual([
            'cargo-bay.graphics_set.connections.bridge_crossing',
            'cargo-bay.graphics_set.connections.bridge_horizontal_narrow',
            'cargo-bay.graphics_set.connections.bridge_horizontal_wide',
            'cargo-bay.graphics_set.connections.bridge_vertical_narrow',
            'cargo-bay.graphics_set.connections.bridge_vertical_wide',
            'cargo-bay.graphics_set.connections.tileset',
            'cargo-bay.graphics_set.connections.tileset_mapping',
            'cargo-bay.platform_graphics_set.connections.bridge_crossing',
            'cargo-bay.platform_graphics_set.connections.bridge_horizontal_narrow',
            'cargo-bay.platform_graphics_set.connections.bridge_horizontal_wide',
            'cargo-bay.platform_graphics_set.connections.bridge_vertical_narrow',
            'cargo-bay.platform_graphics_set.connections.bridge_vertical_wide',
            'cargo-bay.platform_graphics_set.connections.tileset',
            'cargo-bay.platform_graphics_set.connections.tileset_mapping',
            'cargo-landing-pad.graphics_set.connections.bridge_crossing',
            'cargo-landing-pad.graphics_set.connections.bridge_horizontal_narrow',
            'cargo-landing-pad.graphics_set.connections.bridge_horizontal_wide',
            'cargo-landing-pad.graphics_set.connections.bridge_vertical_narrow',
            'cargo-landing-pad.graphics_set.connections.bridge_vertical_wide',
            'cargo-landing-pad.graphics_set.connections.tileset',
            'cargo-landing-pad.graphics_set.connections.tileset_mapping',
            'landing-pad-unloading-bay.graphics_set.connections.bridge_crossing',
            'landing-pad-unloading-bay.graphics_set.connections.bridge_horizontal_narrow',
            'landing-pad-unloading-bay.graphics_set.connections.bridge_horizontal_wide',
            'landing-pad-unloading-bay.graphics_set.connections.bridge_vertical_narrow',
            'landing-pad-unloading-bay.graphics_set.connections.bridge_vertical_wide',
            'landing-pad-unloading-bay.graphics_set.connections.tileset',
            'landing-pad-unloading-bay.graphics_set.connections.tileset_mapping',
            'space-platform-hub.graphics_set.connections.bridge_crossing',
            'space-platform-hub.graphics_set.connections.bridge_horizontal_narrow',
            'space-platform-hub.graphics_set.connections.bridge_horizontal_wide',
            'space-platform-hub.graphics_set.connections.bridge_vertical_narrow',
            'space-platform-hub.graphics_set.connections.bridge_vertical_wide',
            'space-platform-hub.graphics_set.connections.tileset',
            'space-platform-hub.graphics_set.connections.tileset_mapping',
        ])
    })
})
