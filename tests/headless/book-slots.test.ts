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
        expect(book.activeIndex).toBeUndefined()
        expect(book.selectBlueprint().entities.isEmpty()).toBe(true)
        // Asking for index 0 of a book with no blueprints opens the empty view
        // too, and saving it then must not throw.
        expect(book.selectBlueprint(0).isEmpty()).toBe(true)
        expect(book.activeIndex).toBeUndefined()
        expect(book.serialize().active_index).toBe(0)
    })

    /*
        What Factorio does when a book's active slot holds no blueprint: picking
        the book up puts only the book in the cursor, nothing to place. The
        editor shows an empty view for it, and must not rewrite the book for
        having looked: active_index stays the slot it was.
    */
    const SLOTS = (out: { blueprints: { index: number }[] }) => out.blueprints.map(e => e.index)
    const saved = async (book: Book) => decodeBlueprintString(await encode(book)).blueprint_book
    const chest = { name: 'wooden-chest', position: { x: 0.5, y: 0.5 } }

    it('opens nothing when the active slot is empty', async () => {
        const book = await load(sparse(5))
        expect(book.activeIndex).toBeUndefined()
        expect(book.selectBlueprint().isEmpty()).toBe(true)
    })

    it('saves an untouched book with its empty active slot unchanged', async () => {
        const book = await load(sparse(5))
        book.selectBlueprint()
        const out = await saved(book)
        expect(out.active_index).toBe(5)
        expect(SLOTS(out)).toEqual([0, 3, 7])
    })

    it('keeps active_index of a book that was never opened', async () => {
        expect((await saved(await load(sparse(7)))).active_index).toBe(7)
        expect((await saved(await load(sparse(5)))).active_index).toBe(5)
    })

    it('saves what was drawn in the empty view as a new blueprint in that slot', async () => {
        const book = await load(sparse(5))
        book.selectBlueprint().createEntity(chest)
        const out = await saved(book)
        expect(SLOTS(out)).toEqual([0, 3, 5, 7])
        expect(out.active_index).toBe(5)
        expect(out.blueprints[2].blueprint.entities).toHaveLength(1)
        // ...and the new blueprint is now an ordinary member of the book.
        expect(book.activeIndex).toBe(2)
        expect(book.lastBookIndex).toBe(3)
    })

    it('keeps a name given to the empty view, even with nothing drawn', async () => {
        const book = await load(sparse(5))
        book.selectBlueprint().name = 'Named'
        const out = await saved(book)
        expect(out.blueprints.find((e: { index: number }) => e.index === 5).blueprint.label).toBe(
            'Named'
        )
    })

    it('opens nothing for a planner in the active slot, and saves a drawing beside it', async () => {
        const book = await load({
            ...sparse(3),
            blueprints: [
                { index: 0, blueprint: bp('A') },
                {
                    index: 3,
                    deconstruction_planner: { item: 'deconstruction-planner', version: VERSION },
                },
            ],
        })
        expect(book.activeIndex).toBeUndefined()
        book.selectBlueprint().createEntity(chest)
        const out = await saved(book)
        // Slot 3 stays the planner's; the drawing takes the first free slot.
        expect(SLOTS(out)).toEqual([0, 1, 3])
        expect(out.active_index).toBe(1)
    })

    it('opens nothing when a nested book has nothing active', async () => {
        const book = await load({
            item: 'blueprint-book',
            version: VERSION,
            active_index: 5,
            blueprints: [
                { index: 0, blueprint: bp('A') },
                { index: 5, blueprint_book: { ...sparse(2), label: 'inner' } },
            ],
        })
        expect(book.activeIndex).toBeUndefined()
        book.selectBlueprint()
        let out = await saved(book)
        expect(out.active_index).toBe(5)
        expect(out.blueprints[1].blueprint_book.active_index).toBe(2)

        book.selectBlueprint().createEntity(chest)
        out = await saved(book)
        expect(out.active_index).toBe(5)
        expect(out.blueprints[1].blueprint_book.active_index).toBe(2)
        expect(SLOTS(out.blueprints[1].blueprint_book)).toEqual([0, 2, 3, 7])
    })

    it('can still select a blueprint from the empty view', async () => {
        const book = await load(sparse(5))
        book.selectBlueprint()
        expect(book.selectBlueprint(2).name).toBe('C')
        expect((await saved(book)).active_index).toBe(7)
    })
})
