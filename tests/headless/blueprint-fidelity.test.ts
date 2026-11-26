import { beforeAll, describe, expect, it, vi } from 'vite-plus/test'
import * as zlib from 'zlib'
import { Blueprint } from '../../packages/editor/src/core/Blueprint'
import { Book } from '../../packages/editor/src/core/Book'
import { decode } from '../../packages/editor/src/core/bpString'
import { discoverBlueprintFiles, readBlueprintString } from '../helpers/blueprint-files'
import { loadTestData } from '../helpers/load-test-data'

/*
    Loading a blueprint and saving it again must not change it behind the
    user's back - PrOBE writes into the user's own books. These tests pin what
    Blueprint.serialize() gives back for fields the editor does not edit.
*/
describe('blueprint round-trip fidelity in Node', () => {
    beforeAll(loadTestData)

    const chest = { entity_number: 1, name: 'wooden-chest', position: { x: 0.5, y: 0.5 } }

    it('keeps top-level fields it does not model, verbatim', () => {
        const parameters = [
            { type: 'id', name: 'Pick an item', id: 'parameter-0', 'quality-condition': {} },
        ]
        const stock_connections = [{ stock: 2, back: 3 }]
        const out = new Blueprint({
            entities: [chest],
            parameters,
            stock_connections,
            future_field: { a: 1 },
        } as never).serialize() as unknown as Record<string, unknown>
        expect(out.parameters).toEqual(parameters)
        expect(out.stock_connections).toEqual(stock_connections)
        expect(out.future_field).toEqual({ a: 1 })
    })

    it('does not invent a label, but shows "Blueprint" as the name', () => {
        const bp = new Blueprint({ entities: [chest] })
        expect(bp.name).toBe('Blueprint')
        expect(bp.serialize().label).toBeUndefined()
        bp.name = 'Renamed'
        expect(bp.serialize().label).toBe('Renamed')
    })

    it('keeps icons exactly, including quality and an absent type', () => {
        const icons = [
            { index: 1 as const, signal: { name: 'assembling-machine-3', quality: 'legendary' } },
            { index: 2 as const, signal: { type: 'virtual' as const, name: 'signal-A' } },
        ]
        expect(new Blueprint({ entities: [chest], icons }).serialize().icons).toEqual(icons)
    })

    /*
        The whole corpus: every top-level field and every entity field must come
        back as it went in, except the categories listed here. Positions are
        excluded (serialize re-centres them; blueprint-round-trip pins those).
    */
    const ALLOWED: Record<string, number> = {
        // Entities facing north carry no direction in the game's export; the
        // editor writes direction: 0. Same meaning; to be dropped next.
        'entity.direction: added': 149585,
    }

    it('changes nothing else across the test-blueprints corpus', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        const counts: Record<string, number> = {}
        const bump = (k: string) => (counts[k] = (counts[k] ?? 0) + 1)
        const kind = (a: unknown, b: unknown) =>
            a === undefined ? 'added' : b === undefined ? 'dropped' : 'changed'

        for (const file of discoverBlueprintFiles()) {
            const s = readBlueprintString(file.filePath).replace(/\s/g, '')
            const raw = JSON.parse(zlib.inflateSync(Buffer.from(s.slice(1), 'base64')).toString())
            const inputs: Record<string, any>[] = []
            const walk = (x: any) => {
                if (x.blueprint) inputs.push(x.blueprint)
                for (const e of x.blueprint_book?.blueprints ?? []) walk(e)
            }
            walk(raw)
            const loaded = await decode(s)
            const n = loaded instanceof Book ? loaded.lastBookIndex + 1 : 1
            for (let i = 0; i < n; i++) {
                const bp: Blueprint = loaded instanceof Book ? loaded.selectBlueprint(i) : loaded
                const out = bp.serialize() as unknown as Record<string, any>
                const input = inputs[i]
                for (const k of new Set([...Object.keys(input), ...Object.keys(out)])) {
                    if (['entities', 'tiles', 'wires', 'version'].includes(k)) continue
                    if (JSON.stringify(input[k]) !== JSON.stringify(out[k]))
                        bump(`blueprint.${k}: ${kind(input[k], out[k])}`)
                }
                const byNumber = new Map<number, any>(
                    (input.entities ?? []).map((e: any) => [e.entity_number, e])
                )
                for (const e of out.entities ?? []) {
                    const o = byNumber.get(e.entity_number)
                    if (!o) {
                        bump('entity: unknown entity_number')
                        continue
                    }
                    for (const k of new Set([...Object.keys(o), ...Object.keys(e)])) {
                        if (k === 'position') continue
                        if (JSON.stringify(o[k]) !== JSON.stringify(e[k]))
                            bump(`entity.${String(k)}: ${kind(o[k], e[k])}`)
                    }
                }
            }
        }
        expect(counts).toEqual(ALLOWED)
    }, 300_000)
})
