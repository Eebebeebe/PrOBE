import { beforeAll, describe, expect, it } from 'vite-plus/test'
import { Blueprint } from '../../packages/editor/src/core/Blueprint'
import { IllegalFlipError } from '../../packages/editor/src/core/errors'
import { loadTestData } from '../helpers/load-test-data'

describe('flipping entities in Node', () => {
    beforeAll(loadTestData)

    function entity(name: string, direction = 0) {
        const bp = new Blueprint({
            entities: [{ entity_number: 1, name, position: { x: 0.5, y: 0.5 }, direction }],
        })
        const e = bp.entities.get(1)
        if (!e) throw new Error(`${name} was not created`)
        return e
    }

    it('refuses to flip a train stop with a typed Error', () => {
        const stop = entity('train-stop')
        expect(() => stop.getFlippedCopy(false)).toThrow(IllegalFlipError)
        try {
            stop.getFlippedCopy(true)
        } catch (e) {
            expect(e).toBeInstanceOf(Error)
            expect((e as Error).name).toBe('IllegalFlipError')
            expect((e as Error).message).toBe('train-stop cannot be flipped')
        }
    })

    it('flips a belt horizontally', () => {
        // Facing east (4) mirrored across the vertical axis faces west (12).
        expect(entity('transport-belt', 4).getFlippedCopy(false).direction).toBe(12)
    })
})
