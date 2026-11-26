import { beforeAll, describe, expect, it, vi } from 'vite-plus/test'
import type { Blueprint } from '../../packages/editor/src/core/Blueprint'
import { Book } from '../../packages/editor/src/core/Book'
import { decode } from '../../packages/editor/src/core/bpString'
import EXPECTED from '../__fixtures__/round-trip.json'
import { discoverBlueprintFiles, readBlueprintString } from '../helpers/blueprint-files'
import { loadTestData } from '../helpers/load-test-data'

/*
    The Node twin of tests/blueprint-round-trip.spec.ts, and Phase 2's
    acceptance test: the headless core must load and re-serialize the whole
    test-blueprints/ corpus to exactly the numbers the browser produces.

    Both runners read the same fixed point, tests/__fixtures__/round-trip.json,
    and compute the same metrics the same way (see the spec for why there are
    two position checksums). The metric code is written twice because the
    browser's runs inside page.evaluate, which cannot import a helper; agreeing
    on one fixture is what keeps the two honest. A difference here is a real
    environment difference to explain, never a reason to re-record the fixture.
*/

const hashInto = (h: number, s: string): number => {
    let acc = h
    for (let i = 0; i < s.length; i++) {
        acc = ((acc << 5) + acc + s.charCodeAt(i)) | 0
    }
    return acc
}

describe('the test-blueprints corpus round-trips in Node', () => {
    beforeAll(loadTestData)

    it('matches the browser fixed point', async () => {
        const files = discoverBlueprintFiles()
        expect(files.length).toBeGreaterThan(0)

        // The corpus has validation warnings and unknown-prototype notes the
        // browser also logs; they are not what this test pins.
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        vi.spyOn(console, 'log').mockImplementation(() => {})

        let blueprints = 0
        let entities = 0
        let tiles = 0
        let wires = 0
        let icons = 0
        let threw = 0
        let positionChecksum = 0
        let modelPositionChecksum = 0
        let serializedHash = 5381

        for (const file of files) {
            // getBlueprintOrBookFromSource strips whitespace before decoding.
            const loaded = await decode(readBlueprintString(file.filePath).replace(/\s/g, ''))
            const count = loaded instanceof Book ? loaded.lastBookIndex + 1 : 1

            for (let i = 0; i < count; i++) {
                const bp: Blueprint = loaded instanceof Book ? loaded.selectBlueprint(i) : loaded
                blueprints += 1

                for (const e of bp.entities.values()) {
                    modelPositionChecksum =
                        (modelPositionChecksum +
                            Math.round(e.position.x * 4) * 3 +
                            Math.round(e.position.y * 4) * 7) |
                        0
                }
                for (const t of bp.tiles.values()) {
                    modelPositionChecksum =
                        (modelPositionChecksum + Math.round(t.x) * 11 + Math.round(t.y) * 13) | 0
                }

                let obj: ReturnType<Blueprint['serialize']>
                try {
                    obj = bp.serialize()
                } catch {
                    threw += 1
                    continue
                }

                entities += obj.entities ? obj.entities.length : 0
                tiles += obj.tiles ? obj.tiles.length : 0
                wires += obj.wires ? obj.wires.length : 0
                icons += obj.icons ? obj.icons.length : 0

                for (const e of obj.entities ?? []) {
                    positionChecksum =
                        (positionChecksum +
                            Math.round(e.position.x * 4) * 3 +
                            Math.round(e.position.y * 4) * 7) |
                        0
                }

                serializedHash = hashInto(serializedHash, JSON.stringify(obj))
            }
        }

        expect({
            blueprints,
            entities,
            tiles,
            wires,
            icons,
            threw,
            positionChecksum,
            modelPositionChecksum,
            serializedHash,
        }).toEqual(EXPECTED)
    }, 300_000)
})
