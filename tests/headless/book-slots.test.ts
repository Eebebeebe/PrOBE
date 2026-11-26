import { beforeAll, describe, expect, it } from 'vite-plus/test'
import { Book } from '../../packages/editor/src/core/Book'
import { decode, encode } from '../../packages/editor/src/core/bpString'
import {
    decodeBlueprintString,
    encodeBlueprintBook,
    packVersion,
} from '../helpers/encode-blueprint'
import { loadTestData } from '../helpers/load-test-data'

/*
    A book's entries carry the *slot* they occupy in the game's book GUI as
    `index`, and slots can have gaps: a book whose second and third slots are
    empty stores indices 0, 3, 7. `active_index` names a slot too. The editor
    used to read `active_index` as an array position and renumbered the slots
    0, 1, 2... on save, so a sparse book opened the wrong blueprint (or threw)
    and came back with its gaps closed. An empty book threw on load.
*/
const VERSION = packVersion(2, 1, 25)
const bp = (label: string) => ({
    item: 'blueprint',
    version: VERSION,
    label,
    entities: [{ entity_number: 1, name: 'wooden-chest', position: { x: 0.5, y: 0.5 } }],
})
const sparse = (active_index: number) => ({
    item: 'blueprint-book',
    version: VERSION,
    active_index,
    blueprints: [
        { index: 0, blueprint: bp('A') },
        { index: 3, blueprint: bp('B') },
        { index: 7, blueprint: bp('C') },
    ],
})

async function load(book: Record<string, unknown>): Promise<Book> {
    const loaded = await decode(encodeBlueprintBook(book))
    if (!(loaded instanceof Book)) throw new Error('expected a book')
    return loaded
}

describe('book slots in Node', () => {
    beforeAll(loadTestData)

    it('opens the blueprint in the active slot of a sparse book', async () => {
        expect((await load(sparse(3))).selectBlueprint().name).toBe('B')
        expect((await load(sparse(7))).selectBlueprint().name).toBe('C')
    })

    it('keeps the slot gaps and the active slot when saving', async () => {
        const book = await load(sparse(7))
        book.selectBlueprint(1) // flattened 1 is B, in slot 3
        const out = decodeBlueprintString(await encode(book)).blueprint_book
        expect(out.blueprints.map((e: { index: number }) => e.index)).toEqual([0, 3, 7])
        expect(out.active_index).toBe(3)
    })

    it('writes active_index as a slot inside a sparse nested book', async () => {
        const book = await load({
            item: 'blueprint-book',
            version: VERSION,
            active_index: 0,
            blueprints: [
                { index: 0, blueprint: bp('A') },
                { index: 5, blueprint_book: { ...sparse(0), label: 'inner' } },
            ],
        })
        book.selectBlueprint(3) // A, then inner A, B, C: flattened 3 is inner C in slot 7
        const out = decodeBlueprintString(await encode(book)).blueprint_book
        expect(out.active_index).toBe(5)
        expect(out.blueprints[1].blueprint_book.active_index).toBe(7)
        expect(
            out.blueprints[1].blueprint_book.blueprints.map((e: { index: number }) => e.index)
        ).toEqual([0, 3, 7])
    })

    it('loads an empty book', () => {
        const book = new Book({
            item: 'blueprint-book',
            version: VERSION,
            active_index: 0,
            blueprints: [],
        })
        expect(book.lastBookIndex).toBe(-1)
        expect(book.selectBlueprint().entities.isEmpty()).toBe(true)
    })
})
