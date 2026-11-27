import { beforeAll, describe, expect, it } from 'vite-plus/test'
import * as fs from 'fs'
import * as path from 'path'
import * as zlib from 'zlib'
import { Book } from '../../packages/editor/src/core/Book'
import { Blueprint } from '../../packages/editor/src/core/Blueprint'
import {
    CorruptedBlueprintStringError,
    decode,
    encode,
} from '../../packages/editor/src/core/bpString'
import { loadTestData } from '../helpers/load-test-data'

const BOOK = fs
    .readFileSync(
        path.resolve(process.cwd(), 'tests/__fixtures__/books/basic-builder.txt'),
        'utf-8'
    )
    .trim()

/** The JSON inside a blueprint string, read with Node's own zlib rather than the code under test. */
const rawJson = (s: string): Record<string, unknown> =>
    JSON.parse(zlib.inflateSync(Buffer.from(s.slice(1), 'base64')).toString())

describe('the blueprint string codec in Node', () => {
    beforeAll(loadTestData)

    it('decodes the Basic builder book', async () => {
        const book = await decode(BOOK)
        expect(book).toBeInstanceOf(Book)
        const bp = (book as Book).selectBlueprint(0)
        expect(bp).toBeInstanceOf(Blueprint)
        expect(bp.entities.valuesArray()).toHaveLength(20)
        expect(bp.entities.filter(e => e.name === 'assembling-machine-3')).toHaveLength(2)
    })

    it('re-encodes it to the same JSON apart from the version stamp', async () => {
        const again = await encode(await decode(BOOK))
        const before = rawJson(BOOK) as { blueprint_book: Record<string, unknown> }
        const after = rawJson(again) as { blueprint_book: Record<string, unknown> }
        // The editor stamps its own version on save, as the game does on
        // export. Both say 2.1.25, but the game also fills the lowest 16 bits
        // with a build number (10 here) and the editor writes 0.
        delete before.blueprint_book.version
        delete after.blueprint_book.version
        expect(after).toEqual(before)
    })

    it('rejects a corrupted string with a typed error', async () => {
        await expect(decode('0not-a-blueprint')).rejects.toBeInstanceOf(
            CorruptedBlueprintStringError
        )
    })
})
