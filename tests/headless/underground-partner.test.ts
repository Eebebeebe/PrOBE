import { beforeAll, describe, expect, it } from 'vite-plus/test'
import { Blueprint } from '../../packages/editor/src/core/Blueprint'
import type { Entity } from '../../packages/editor/src/core/Entity'
import { loadTestData } from '../helpers/load-test-data'

/*
    Finding an underground belt's partner (PositionGrid.getOpposingEntity),
    which pair rotation, the underground line and upgrades rely on. Directions
    are 16ths since Factorio 2.0: north 0, east 4, south 8, west 12. The search
    used the old 8-direction rules (horizontal = not a multiple of 4, "back" =
    0 or 6), so east and west were searched as if they pointed south and
    horizontal undergrounds never found their partner.
*/
function first(bp: Blueprint): Entity {
    const e = bp.entities.get(1)
    if (!e) throw new Error('entity 1 missing')
    return e
}

const pair = (direction: number, a: { x: number; y: number }, b: { x: number; y: number }) =>
    new Blueprint({
        entities: [
            { entity_number: 1, name: 'underground-belt', position: a, direction, type: 'input' },
            { entity_number: 2, name: 'underground-belt', position: b, direction, type: 'output' },
        ],
    })

describe('underground belt partner search', () => {
    beforeAll(loadTestData)

    for (const [label, direction, dx, dy] of [
        ['north', 0, 0, -1],
        ['east', 4, 1, 0],
        ['south', 8, 0, 1],
        ['west', 12, -1, 0],
    ] as const) {
        it(`finds the output four tiles ${label} of an input facing ${label}`, () => {
            const bp = pair(direction, { x: 0.5, y: 0.5 }, { x: 0.5 + 4 * dx, y: 0.5 + 4 * dy })
            const input = first(bp)
            const found = bp.entityPositionGrid.getOpposingEntity(
                'underground-belt',
                direction,
                input.position,
                direction,
                5
            )
            expect(found).toBe(2)
        })
    }

    it('does not find a partner beyond the reach it is given', () => {
        const bp = pair(4, { x: 0.5, y: 0.5 }, { x: 6.5, y: 0.5 })
        const input = first(bp)
        expect(
            bp.entityPositionGrid.getOpposingEntity('underground-belt', 4, input.position, 4, 5)
        ).toBeUndefined()
    })
})
