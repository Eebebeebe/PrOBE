import { afterEach, beforeAll, describe, expect, it } from 'vite-plus/test'
import { Blueprint } from '../../packages/editor/src/core/Blueprint'
import { coreSettings } from '../../packages/editor/src/core/config'
import { loadTestData } from '../helpers/load-test-data'

/*
    The first headless entity move. Entity's position setter used to read the
    wire-reach setting from the PixiJS BlueprintContainer (G.BPC), which is
    undefined outside the browser, so this threw a TypeError in Node.
*/
describe('moving a wired pole in Node', () => {
    beforeAll(loadTestData)
    afterEach(() => {
        coreSettings.limitWireReach = true
    })

    // Two medium poles 5 tiles apart, joined by a copper wire (connector 5).
    // A medium pole reaches 9 tiles. The Blueprint constructor re-centres the
    // layout, so moves are made relative to where pole 2 actually starts.
    function poles() {
        const bp = new Blueprint({
            entities: [
                { entity_number: 1, name: 'medium-electric-pole', position: { x: 0.5, y: 0.5 } },
                { entity_number: 2, name: 'medium-electric-pole', position: { x: 5.5, y: 0.5 } },
            ],
            wires: [[1, 5, 2, 5]],
        })
        const pole = bp.entities.get(2)
        if (!pole) throw new Error('pole 2 was not created')
        const start = { ...pole.position }
        const moveBy = (dx: number) => {
            pole.position = { x: start.x + dx, y: start.y }
            return pole.position.x - start.x
        }
        return { moveBy }
    }

    it('keeps a move inside the wire reach', () => {
        // 5 + 3 = 8 tiles apart, inside the 9-tile reach.
        expect(poles().moveBy(3)).toBe(3)
    })

    it('refuses a move that would stretch the wire past its reach', () => {
        // 5 + 7 = 12 tiles apart: the pole stays where it was.
        expect(poles().moveBy(7)).toBe(0)
    })

    it('allows that move when the reach limit is off', () => {
        coreSettings.limitWireReach = false
        expect(poles().moveBy(7)).toBe(7)
    })
})
