import { beforeAll, describe, expect, it } from 'vite-plus/test'
import { readFileSync } from 'fs'
import { Blueprint } from '../../packages/editor/src/core/Blueprint'
import { Book } from '../../packages/editor/src/core/Book'
import { decode } from '../../packages/editor/src/core/bpString'
import { TextTooLongError } from '../../packages/editor/src/core/errors'
import { utf8Length } from '../../packages/editor/src/core/textLimits'
import { loadTestData } from '../helpers/load-test-data'

/*
    What a script changes on a blueprint besides its entities: its label and
    description, and copies of it to paste. The byte limits are Factorio's own,
    measured on 2.1.25 (tools/oracle/fixtures/text-limits.json): the game cuts
    longer text silently, so the editor refuses it instead.
*/
const chest = { entity_number: 1, name: 'wooden-chest', position: { x: 0.5, y: 0.5 } }

async function basicBuilder(): Promise<Blueprint> {
    const book = await decode(readFileSync('tests/__fixtures__/books/basic-builder.txt', 'utf8').trim())
    if (!(book instanceof Book)) throw new Error('expected the basic-builder book')
    return book.selectBlueprint(0)
}

describe('blueprint label and description', () => {
    beforeAll(loadTestData)

    it('counts text in UTF-8 bytes, as the game does', () => {
        expect(utf8Length('abc')).toBe(3)
        expect(utf8Length('ä')).toBe(2)
        expect(utf8Length('€')).toBe(3)
        expect(utf8Length('🚂')).toBe(4)
    })

    it('takes a label up to 200 bytes and refuses one byte more', () => {
        const bp = new Blueprint({ entities: [chest] })
        bp.label = 'a'.repeat(200)
        expect(bp.serialize().label).toHaveLength(200)
        expect(() => (bp.label = 'a'.repeat(201))).toThrow(TextTooLongError)
        // 100 two-byte characters are 200 bytes: still fine. One more is not.
        bp.label = 'ä'.repeat(100)
        expect(() => (bp.label = 'ä'.repeat(101))).toThrow(TextTooLongError)
        // A refused label leaves the old one in place.
        expect(bp.label).toBe('ä'.repeat(100))
    })

    it('takes a description up to 500 bytes and names the limit when refusing', () => {
        const bp = new Blueprint({ entities: [chest] })
        bp.description = 'x'.repeat(500)
        expect(bp.serialize().description).toHaveLength(500)
        expect(() => (bp.description = 'x'.repeat(501))).toThrow(
            'Blueprint description is 501 bytes (UTF-8); Factorio keeps only 500'
        )
    })

    it('clears both with undefined', () => {
        const bp = new Blueprint({ entities: [chest], label: 'L', description: 'D' })
        expect([bp.label, bp.description]).toEqual(['L', 'D'])
        bp.label = undefined
        bp.description = undefined
        const out = bp.serialize()
        expect(out.label).toBeUndefined()
        expect(out.description).toBeUndefined()
        expect(bp.name).toBe('Blueprint')
    })
})

describe('Blueprint.clone', () => {
    beforeAll(loadTestData)

    it('copies entities, wires, tiles and text', async () => {
        const original = await basicBuilder()
        const before = original.serialize()
        expect(before.wires?.length).toBeGreaterThan(0)

        const a = original.clone()
        const b = original.clone()
        for (const copy of [a, b]) {
            const out = copy.serialize()
            expect(out.entities).toEqual(before.entities)
            expect(out.wires).toEqual(before.wires)
            expect(out.label).toBe('Basic builder')
        }
    })

    it('is independent of the original and of other copies', async () => {
        const original = await basicBuilder()
        const before = JSON.stringify(original.serialize())
        const a = original.clone()
        const b = original.clone()

        a.label = 'changed'
        a.entities.valuesArray()[0].destroy()
        expect(JSON.stringify(original.serialize())).toBe(before)
        expect(b.entities.size).toBe(original.entities.size)
        expect(b.label).toBe('Basic builder')
    })
})
