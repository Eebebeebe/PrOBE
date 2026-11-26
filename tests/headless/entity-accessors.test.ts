import { beforeAll, describe, expect, it, vi } from 'vite-plus/test'
import type { Blueprint } from '../../packages/editor/src/core/Blueprint'
import { Book } from '../../packages/editor/src/core/Book'
import { decode } from '../../packages/editor/src/core/bpString'
import EXPECTED from '../__fixtures__/entity-accessors.json'
import { discoverBlueprintFiles, readBlueprintString } from '../helpers/blueprint-files'
import {
    TALLIED_SHAPE,
    TALLIED_VALUES,
    type AccessorTally,
    type Tally,
} from '../helpers/entity-accessor-keys'
import { loadTestData } from '../helpers/load-test-data'

/*
    The Node twin of tests/entity-accessors.spec.ts: every Entity accessor in
    the two shared lists, tallied over the whole test-blueprints/ corpus with
    the headless core, must give exactly the browser's fixed point
    (tests/__fixtures__/entity-accessors.json). See the spec for what is
    tallied and why. The tally loop is written twice because the browser's runs
    inside page.evaluate; the shared fixture keeps the two in step.
*/

/** `undefined` and `null` stay distinct, as in the spec. */
const keyOf = (v: unknown): string => {
    if (v === undefined) return 'undefined'
    if (v === null) return 'null'
    if (typeof v === 'object') return JSON.stringify(v)
    return String(v as string | number | boolean | symbol | bigint)
}

async function tallyCorpus(): Promise<AccessorTally> {
    const shape: Record<string, Tally> = {}
    const values: Record<string, Record<string, number>> = {}
    const bumpShape = (key: string, field: keyof Tally): void => {
        shape[key] ??= { value: 0, empty: 0, nothing: 0, threw: 0 }
        shape[key][field] += 1
    }
    const bumpValue = (key: string, bucket: string): void => {
        values[key] ??= {}
        values[key][bucket] = (values[key][bucket] ?? 0) + 1
    }

    let entityCount = 0
    let blueprintCount = 0
    for (const file of discoverBlueprintFiles()) {
        const loaded = await decode(readBlueprintString(file.filePath).replace(/\s/g, ''))
        const count = loaded instanceof Book ? loaded.lastBookIndex + 1 : 1
        for (let i = 0; i < count; i++) {
            const bp: Blueprint = loaded instanceof Book ? loaded.selectBlueprint(i) : loaded
            blueprintCount += 1
            for (const e of bp.entities.values()) {
                entityCount += 1
                const read = e as unknown as Record<string, unknown>
                for (const key of TALLIED_SHAPE) {
                    let v: unknown
                    try {
                        v = read[key]
                    } catch {
                        bumpShape(key, 'threw')
                        continue
                    }
                    if (v === undefined || v === null) bumpShape(key, 'nothing')
                    else if (Array.isArray(v) && v.length === 0) bumpShape(key, 'empty')
                    else bumpShape(key, 'value')
                }
                for (const key of TALLIED_VALUES) {
                    let v: unknown
                    try {
                        v = read[key]
                    } catch {
                        bumpValue(key, 'THREW')
                        continue
                    }
                    bumpValue(key, keyOf(v))
                }
            }
        }
    }
    return { entityCount, blueprintCount, shape, values }
}

describe('Entity accessors over the corpus in Node', () => {
    beforeAll(loadTestData)

    it('match the browser fixed point', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        vi.spyOn(console, 'log').mockImplementation(() => {})
        const tally = await tallyCorpus()

        // The spec's four structural guards, so a problem is named, not diffed.
        expect([...TALLIED_VALUES].sort()).toEqual(Object.keys(EXPECTED.values).sort())
        expect(Object.keys(tally.values).sort()).toEqual([...TALLIED_VALUES].sort())
        for (const [key, hist] of Object.entries(tally.values)) {
            const total = Object.values(hist).reduce((a, b) => a + b, 0)
            expect(total, `${key} histogram does not cover every entity`).toBe(tally.entityCount)
            expect(
                Object.keys(hist).length,
                `${key} is no longer a closed set`
            ).toBeLessThanOrEqual(16)
        }

        expect(tally).toEqual(EXPECTED)
    }, 300_000)
})
