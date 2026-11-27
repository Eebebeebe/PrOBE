import { beforeAll, describe, expect, it } from 'vite-plus/test'
import { Book } from '../../packages/editor/src/core/Book'
import { decode } from '../../packages/editor/src/core/bpString'
import { AmbiguousLabelError } from '../../packages/editor/src/core/errors'
import { encodeBlueprintBook, packVersion } from '../helpers/encode-blueprint'
import { loadTestData } from '../helpers/load-test-data'

/*
    The Book API scripts use: list what a book holds, and find a blueprint by
    its label - `factorio.get_blueprint('Smelter')`. A blueprint is addressed
    by its path of *slots*, not array positions, since books keep gaps.

    The book below has every case: a gap (slots 1, 2 missing), a planner, a
    nested book, the same label twice, a #code book that scripts do not see
    unless they ask, and a blueprint without a label.
*/
const VERSION = packVersion(2, 1, 25)
const bp = (label?: string) => ({
    item: 'blueprint',
    version: VERSION,
    ...(label === undefined ? {} : { label }),
    entities: [{ entity_number: 1, name: 'wooden-chest', position: { x: 0.5, y: 0.5 } }],
})
const BOOK = {
    item: 'blueprint-book',
    version: VERSION,
    active_index: 0,
    label: 'Factory',
    description: 'Everything',
    blueprints: [
        { index: 0, blueprint: bp('Basic builder') },
        { index: 3, blueprint: bp('Smelter') },
        {
            index: 4,
            deconstruction_planner: {
                item: 'deconstruction-planner',
                version: VERSION,
                label: 'Clear',
            },
        },
        {
            index: 5,
            blueprint_book: {
                item: 'blueprint-book',
                version: VERSION,
                active_index: 0,
                label: 'Modules',
                blueprints: [
                    { index: 0, blueprint: bp('Smelter') },
                    { index: 2, blueprint: bp('Belt') },
                    {
                        index: 7,
                        blueprint_book: {
                            item: 'blueprint-book',
                            version: VERSION,
                            active_index: 0,
                            label: '#code',
                            blueprints: [{ index: 0, blueprint: bp('builder') }],
                        },
                    },
                ],
            },
        },
        { index: 9, blueprint: bp() },
    ],
}

async function load(): Promise<Book> {
    const loaded = await decode(encodeBlueprintBook(BOOK))
    if (!(loaded instanceof Book)) throw new Error('expected a book')
    return loaded
}

describe('Book.entries', () => {
    beforeAll(loadTestData)

    it('lists every entry by slot path, kind and label, nested books included', async () => {
        const book = await load()
        const flat = (es: ReturnType<Book['entries']>): string[] =>
            es.flatMap(e => [
                `${e.path.join('.')} ${e.kind} ${e.label ?? '-'}`,
                ...(e.children ? flat(e.children) : []),
            ])
        expect(flat(book.entries())).toEqual([
            '0 blueprint Basic builder',
            '3 blueprint Smelter',
            '4 deconstruction-planner Clear',
            '5 book Modules',
            '5.0 blueprint Smelter',
            '5.2 blueprint Belt',
            '5.7 book #code',
            '5.7.0 blueprint builder',
            '9 blueprint -',
        ])
    })

    it('has the book label and description', async () => {
        const book = await load()
        expect([book.label, book.description]).toEqual(['Factory', 'Everything'])
    })
})

describe('Book.findByLabel', () => {
    beforeAll(loadTestData)

    it('finds a blueprint at the top level and inside nested books', async () => {
        const book = await load()
        expect(book.findByLabel('Basic builder')).toEqual([0])
        expect(book.findByLabel('Belt')).toEqual([5, 2])
    })

    it('stays at the top level when asked not to recurse', async () => {
        const book = await load()
        expect(book.findByLabel('Belt', { recursive: false })).toBeUndefined()
    })

    it('answers undefined for a label nothing has', async () => {
        expect((await load()).findByLabel('Nope')).toBeUndefined()
    })

    it('refuses an ambiguous label, naming every match', async () => {
        const book = await load()
        expect(() => book.findByLabel('Smelter')).toThrow(AmbiguousLabelError)
        expect(() => book.findByLabel('Smelter')).toThrow(
            '2 blueprints are labelled "Smelter": slots 3 and 5.0'
        )
        // Taking the first, in slot order, has to be asked for.
        expect(book.findByLabel('Smelter', { unique: false })).toEqual([3])
        expect(book.findAllByLabel('Smelter')).toEqual([[3], [5, 0]])
    })

    it('finds only blueprints, not planners or books', async () => {
        const book = await load()
        expect(book.findByLabel('Clear')).toBeUndefined()
        expect(book.findByLabel('Modules')).toBeUndefined()
    })

    it('leaves #-books and their contents out unless asked', async () => {
        const book = await load()
        expect(book.findByLabel('builder')).toBeUndefined()
        expect(book.findByLabel('builder', { includeHidden: true })).toEqual([5, 7, 0])
    })
})

describe('Book.getBlueprint', () => {
    beforeAll(loadTestData)

    it('gives an independent copy of the blueprint at a path', async () => {
        const book = await load()
        const copy = book.getBlueprint([5, 2])
        expect(copy.label).toBe('Belt')
        copy.label = 'Changed'
        copy.entities.valuesArray()[0].destroy()
        const again = book.getBlueprint([5, 2])
        expect(again.label).toBe('Belt')
        expect(again.entities.size).toBe(1)
    })

    it('does not change which blueprint the editor has open', async () => {
        const book = await load()
        book.selectBlueprint(1)
        book.getBlueprint([5, 2])
        expect(book.activeIndex).toBe(1)
    })

    it('says what is in the way when the path holds no blueprint', async () => {
        const book = await load()
        expect(() => book.getBlueprint([4])).toThrow(
            'slot 4 holds a deconstruction planner, not a blueprint'
        )
        expect(() => book.getBlueprint([1])).toThrow('nothing is in slot 1')
        expect(() => book.getBlueprint([5])).toThrow('slot 5 holds a book, not a blueprint')
        expect(() => book.getBlueprint([0, 1])).toThrow('slot 0 holds a blueprint, not a book')
        expect(() => book.getBlueprint([])).toThrow('an empty path')
    })
})

describe('Book changes', () => {
    beforeAll(loadTestData)

    const labels = (book: Book) =>
        book
            .entries()
            .map(e => `${e.path.join('.')}:${e.label ?? '-'}`)
            .join(' ')

    it('replaces a blueprint in place', async () => {
        const book = await load()
        const bp = book.getBlueprint([0])
        bp.label = 'Builder v2'
        book.setBlueprint([0], bp)
        expect(book.getBlueprint([0]).label).toBe('Builder v2')
        expect(labels(book)).toBe('0:Builder v2 3:Smelter 4:Clear 5:Modules 9:-')
    })

    it('refuses to replace anything but a blueprint', async () => {
        const book = await load()
        const bp = book.getBlueprint([0])
        expect(() => book.setBlueprint([4], bp)).toThrow('slot 4 holds a deconstruction planner')
        expect(() => book.setBlueprint([1], bp)).toThrow('nothing is in slot 1')
    })

    it('does not let the open blueprint overwrite a replacement', async () => {
        const book = await load()
        book.selectBlueprint(0) // opens Basic builder
        const bp = book.getBlueprint([0])
        bp.label = 'Replaced'
        book.setBlueprint([0], bp)
        expect(book.selectBlueprint(0).label).toBe('Replaced')
    })

    it('adds a blueprint in the lowest free slot, or the one given', async () => {
        const book = await load()
        const bp = book.getBlueprint([0])
        bp.label = 'New'
        expect(book.addBlueprint(bp)).toEqual([1])
        expect(book.addBlueprint(bp, { slot: 20 })).toEqual([20])
        expect(book.addBlueprint(bp, { into: [5] })).toEqual([5, 1])
        expect(labels(book)).toBe('0:Basic builder 1:New 3:Smelter 4:Clear 5:Modules 9:- 20:New')
        expect(() => book.addBlueprint(bp, { slot: 3 })).toThrow('slot 3 is taken')
        expect(() => book.addBlueprint(bp, { into: [0] })).toThrow(
            'slot 0 holds a blueprint, not a book'
        )
    })

    it('keeps the open blueprint open when entries are added before it', async () => {
        const book = await load()
        const open = book.selectBlueprint(1) // Smelter in slot 3
        expect(open.label).toBe('Smelter')
        book.addBlueprint(book.getBlueprint([0])) // into slot 1, before it
        expect(book.selectBlueprint().label).toBe('Smelter')
    })

    it('adds a book, which then takes blueprints', async () => {
        const book = await load()
        const path = book.addBook('Outposts')
        expect(path).toEqual([1])
        const bp = book.getBlueprint([0])
        expect(book.addBlueprint(bp, { into: path })).toEqual([1, 0])
        expect(book.findByLabel('Basic builder', { unique: false })).toEqual([0])
        expect(book.findAllByLabel('Basic builder')).toEqual([[0], [1, 0]])
    })

    it('saves the changes', async () => {
        const book = await load()
        book.addBlueprint(book.getBlueprint([0]), { slot: 12 })
        const out = book.serialize()
        expect((out.blueprints ?? []).map(e => e.index)).toEqual([0, 3, 4, 5, 9, 12])
    })
})
