import { afterEach, beforeAll, describe, expect, it, vi } from 'vite-plus/test'
import { Blueprint, oilOutpostSettings } from '../../packages/editor/src/core/Blueprint'
import type { IVisualization } from '../../packages/editor/src/core/generators'
import { loadTestData } from '../helpers/load-test-data'

/*
    Blueprint.generatePipes used to draw its debug visualisation itself, with
    PixiJS sprites added to G.BPC. It now emits 'generate-pipes-debug' and the
    renderer (BlueprintContainer) draws, so the generator runs in Node.
*/
describe('generatePipes in Node', () => {
    beforeAll(loadTestData)
    afterEach(() => {
        oilOutpostSettings.DEBUG = false
        vi.restoreAllMocks()
    })

    function outpost() {
        vi.spyOn(console, 'log').mockImplementation(() => {})
        return new Blueprint({
            entities: [
                { entity_number: 1, name: 'pumpjack', position: { x: 1.5, y: 1.5 } },
                { entity_number: 2, name: 'pumpjack', position: { x: 10.5, y: 1.5 } },
            ],
        })
    }

    it('adds pipes to an outpost and emits nothing when DEBUG is off', () => {
        const bp = outpost()
        const events: IVisualization[][][] = []
        bp.on('generate-pipes-debug', v => events.push(v))
        expect(bp.generatePipes()).toBeUndefined()
        expect(
            bp.entities.filter(e => e.name === 'pipe' || e.name === 'pipe-to-ground').length
        ).toBeGreaterThan(0)
        expect(events).toEqual([])
    })

    it('emits the search paths once when DEBUG is on', () => {
        oilOutpostSettings.DEBUG = true
        const bp = outpost()
        const events: IVisualization[][][] = []
        bp.on('generate-pipes-debug', v => events.push(v))
        bp.generatePipes()
        expect(events).toHaveLength(1)
        const paths = events[0].flat()
        expect(paths.length).toBeGreaterThan(0)
        for (const v of paths) expect(Array.isArray(v.path)).toBe(true)
    })
})
