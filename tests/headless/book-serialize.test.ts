import { beforeAll, describe, expect, it } from 'vite-plus/test'
import { Book } from '../../packages/editor/src/core/Book'
import { decode, encode } from '../../packages/editor/src/core/bpString'
import { decodeBlueprintString, encodeBlueprintBook } from '../helpers/encode-blueprint'
import { loadTestData } from '../helpers/load-test-data'
import { BOOK } from '../helpers/nested-book'

/*
    The Node twin of tests/book-serialize.spec.ts: Book's flattened-index
    arithmetic and the active_index it writes, on the same hand-built book
    (A, a nested book holding B and C, then D). The browser's selectBookIndex
    and encodeLoaded are Book.selectBlueprint and encode(book); here they are
    called directly.
*/
describe('Book index arithmetic in Node', () => {
    beforeAll(loadTestData)

    const load = async (): Promise<Book> => {
        const loaded = await decode(encodeBlueprintBook(BOOK))
        if (!(loaded instanceof Book)) throw new Error('expected a book')
        return loaded
    }
    const saved = async (book: Book) => decodeBlueprintString(await encode(book)).blueprint_book

    it('a flattened index reaches the blueprint at that position', async () => {
        const book = await load()
        const labels = [0, 1, 2, 3].map(i => book.selectBlueprint(i).name)
        expect(labels).toEqual(['A', 'B', 'C', 'D'])
    })

    it('reports its last flattened index, counting nested entries', async () => {
        expect((await load()).lastBookIndex).toBe(3)
    })

    it('writes active_index at every level it passed through', async () => {
        const book = await load()
        book.selectBlueprint(2)
        const out = await saved(book)
        expect(out.active_index).toBe(1)
        expect(out.blueprints[1].blueprint_book.active_index).toBe(1)
    })

    it('points back at a top-level entry after a nested one', async () => {
        const book = await load()
        book.selectBlueprint(2)
        book.selectBlueprint(3)
        expect((await saved(book)).active_index).toBe(2)
    })

    it('keeps every blueprint through a select and serialize walk', async () => {
        const book = await load()
        for (let i = 0; i <= 3; i++) book.selectBlueprint(i)
        const out = await saved(book)
        expect([
            out.blueprints[0].blueprint.label,
            out.blueprints[1].blueprint_book.blueprints[0].blueprint.label,
            out.blueprints[1].blueprint_book.blueprints[1].blueprint.label,
            out.blueprints[2].blueprint.label,
        ]).toEqual(['A', 'B', 'C', 'D'])
    })
})
