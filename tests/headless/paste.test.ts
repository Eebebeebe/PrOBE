import { beforeAll, describe, expect, it } from 'vite-plus/test'
import { readFileSync } from 'fs'
import { Blueprint } from '../../packages/editor/src/core/Blueprint'
import { Book } from '../../packages/editor/src/core/Book'
import { decode } from '../../packages/editor/src/core/bpString'
import { CollisionError, ParityError } from '../../packages/editor/src/core/errors'
import { pasteInto } from '../../packages/editor/src/core/paste'
import { loadTestData } from '../helpers/load-test-data'

/*
    core/paste.ts: pasting one blueprint into another, as scripts build an
    instance. The pole half replays the game's own answers
    (tools/oracle/fixtures/pole-paste.json) rather than restating a rule.
*/

const POLE = 'medium-electric-pole'
const COPPER = 5

type Raw = { name: string; x: number; y: number; direction?: number }
const blueprint = (entities: Raw[], wires: [number, number][] = []): Blueprint =>
    new Blueprint({
        entities: entities.map((e, i) => ({
            entity_number: i + 1,
            name: e.name,
            position: { x: e.x, y: e.y },
            ...(e.direction === undefined ? {} : { direction: e.direction }),
        })),
        wires: wires.map(([a, b]) => [a, COPPER, b, COPPER]),
    } as never)

/** How far the constructor moved this blueprint's entities from their raw positions. */
const shiftOf = (bp: Blueprint, raw: { x: number; y: number }): { x: number; y: number } => {
    const first = bp.entities.get(1)
    if (!first) return { x: 0, y: 0 }
    return { x: first.position.x - raw.x, y: first.position.y - raw.y }
}

async function basicBuilder(): Promise<Blueprint> {
    const book = await decode(
        readFileSync('tests/__fixtures__/books/basic-builder.txt', 'utf8').trim()
    )
    if (!(book instanceof Book)) throw new Error('expected the basic-builder book')
    return book.selectBlueprint(0)
}

describe('pasting poles connects them as the game does', () => {
    beforeAll(loadTestData)

    const fixture = JSON.parse(readFileSync('tools/oracle/fixtures/pole-paste.json', 'utf8')) as {
        cases: {
            id: string
            existing: [number, number][]
            blueprint: { poles: [number, number][]; wires: [number, number][] } | null
        }[]
        result: Record<string, { poles: Record<string, string[]> }>
    }

    for (const c of fixture.cases.filter(c => c.blueprint !== null)) {
        it(`case ${c.id}`, () => {
            const expected = fixture.result[c.id].poles
            const key = ([x, y]: [number, number]) => `${x},${y}`
            const existingKeys = new Set(c.existing.map(key))
            // Where the game put the pasted poles: every pole that was not there before.
            const pastedAt = Object.keys(expected)
                .filter(k => !existingKeys.has(k))
                .map(k => k.split(',').map(Number) as [number, number])
                .sort((a, b) => a[0] - b[0] || a[1] - b[1])
            const bpPoles = [...(c.blueprint?.poles ?? [])].sort(
                (a, b) => a[0] - b[0] || a[1] - b[1]
            )
            expect(pastedAt.length).toBe(bpPoles.length)

            // The destination as it was before the paste: the existing poles and
            // the wires between them (the paste never touches those).
            const existingIndex = new Map(c.existing.map((p, i) => [key(p), i + 1]))
            const existingWires: [number, number][] = []
            for (const [k, links] of Object.entries(expected)) {
                for (const l of links) {
                    const a = existingIndex.get(k)
                    const b = existingIndex.get(l)
                    if (a !== undefined && b !== undefined && a < b) existingWires.push([a, b])
                }
            }
            const dest = blueprint(
                c.existing.map(([x, y]) => ({ name: POLE, x: x + 0.5, y: y + 0.5 })),
                existingWires
            )
            // The pasted blueprint, its poles where the game put them.
            const order = new Map(
                (c.blueprint?.poles ?? []).map(p => [
                    key(p),
                    bpPoles.findIndex(q => key(q) === key(p)),
                ])
            )
            const src = blueprint(
                pastedAt.map(([x, y]) => ({ name: POLE, x: x + 0.5, y: y + 0.5 })),
                (c.blueprint?.wires ?? []).map(([a, b]) => {
                    const pa = c.blueprint?.poles[a - 1] ?? [0, 0]
                    const pb = c.blueprint?.poles[b - 1] ?? [0, 0]
                    return [(order.get(key(pa)) ?? 0) + 1, (order.get(key(pb)) ?? 0) + 1]
                })
            )
            const d =
                c.existing.length > 0
                    ? shiftOf(dest, { x: c.existing[0][0] + 0.5, y: c.existing[0][1] + 0.5 })
                    : { x: 0, y: 0 }
            const s = shiftOf(src, { x: pastedAt[0][0] + 0.5, y: pastedAt[0][1] + 0.5 })
            pasteInto(dest, src, { x: d.x - s.x, y: d.y - s.y })

            // Read the copper graph back in the game's coordinates.
            const tile = (n: number): string => {
                const e = dest.entities.get(n)
                if (!e) throw new Error(`entity ${n} missing`)
                return `${e.position.x - d.x - 0.5},${e.position.y - d.y - 0.5}`
            }
            const got: Record<string, string[]> = {}
            for (const e of dest.entities.values()) {
                got[tile(e.entityNumber)] = dest.wireConnections
                    .getEntityConnections(e.entityNumber)
                    .filter(w => w.color === 'copper')
                    .map(w =>
                        tile(
                            w.cps[0].entityNumber === e.entityNumber
                                ? w.cps[1].entityNumber
                                : w.cps[0].entityNumber
                        )
                    )
                    .sort()
            }
            const sorted = (r: Record<string, string[]>) =>
                Object.fromEntries(
                    Object.entries(r)
                        .map(([k, v]) => [k, [...v].sort((x, y) => x.localeCompare(y))] as const)
                        .sort(([x], [y]) => x.localeCompare(y))
                )
            expect(sorted(got)).toEqual(sorted(expected))
        })
    }
})

describe('pasteInto', () => {
    beforeAll(loadTestData)

    it('pastes n copies with n times the entities, each copy wired only to itself', async () => {
        const unit = await basicBuilder()
        const per = unit.entities.size
        const wiresPer = unit.serialize().wires?.length ?? 0
        expect(wiresPer).toBeGreaterThan(0)
        const dest = new Blueprint()
        const copies = [0, 40, 80].map(x => pasteInto(dest, unit, { x, y: 0 }))
        expect(dest.entities.size).toBe(3 * per)
        expect(dest.serialize().wires?.length).toBe(3 * wiresPer)
        // No wire runs between two copies.
        const copyOf = new Map<number, number>()
        copies.forEach((r, i) => r.created.forEach(e => copyOf.set(e.entityNumber, i)))
        for (const e of dest.entities.values()) {
            for (const w of dest.wireConnections.getEntityConnections(e.entityNumber)) {
                expect(copyOf.get(w.cps[0].entityNumber)).toBe(copyOf.get(w.cps[1].entityNumber))
            }
        }
    })

    it('gives the same result for the same input', async () => {
        const unit = await basicBuilder()
        const once = () => {
            const dest = new Blueprint()
            pasteInto(dest, unit, { x: 0, y: 0 })
            pasteInto(dest, unit, { x: 0, y: 20 })
            return JSON.stringify(dest.serialize())
        }
        expect(once()).toBe(once())
    })

    it('refuses a collision by default, naming what is in the way, and changes nothing', () => {
        const dest = blueprint([{ name: 'wooden-chest', x: 0.5, y: 0.5 }])
        const before = JSON.stringify(dest.serialize())
        const chest = dest.entities.get(1)
        if (!chest) throw new Error('missing')
        const src = blueprint([{ name: 'iron-chest', x: 0.5, y: 0.5 }])
        const offset = {
            x: chest.position.x - (src.entities.get(1)?.position.x ?? 0),
            y: chest.position.y - (src.entities.get(1)?.position.y ?? 0),
        }
        expect(() => pasteInto(dest, src, offset)).toThrow(CollisionError)
        expect(() => pasteInto(dest, src, offset)).toThrow(
            `iron-chest at (${chest.position.x}, ${chest.position.y}): wooden-chest at (${chest.position.x}, ${chest.position.y}) in the way`
        )
        expect(JSON.stringify(dest.serialize())).toBe(before)
    })

    it('places what fits with skip, and reports the rest', () => {
        const dest = blueprint([{ name: 'wooden-chest', x: 0.5, y: 0.5 }])
        const src = blueprint([
            { name: 'iron-chest', x: 0.5, y: 0.5 },
            { name: 'iron-chest', x: 3.5, y: 0.5 },
        ])
        const offset = {
            x: (dest.entities.get(1)?.position.x ?? 0) - 0.5,
            y: (dest.entities.get(1)?.position.y ?? 0) - 0.5,
        }
        const s = shiftOf(src, { x: 0.5, y: 0.5 })
        const r = pasteInto(
            dest,
            src,
            { x: offset.x - s.x, y: offset.y - s.y },
            { onConflict: 'skip' }
        )
        expect(r.created.map(e => e.name)).toEqual(['iron-chest'])
        expect(r.conflicts.map(c => c.name)).toEqual(['iron-chest'])
        expect(dest.entities.size).toBe(2)
    })

    it('removes what is in the way with replace', () => {
        const dest = blueprint([{ name: 'wooden-chest', x: 0.5, y: 0.5 }])
        const src = blueprint([{ name: 'assembling-machine-2', x: 1.5, y: 1.5 }])
        const d = shiftOf(dest, { x: 0.5, y: 0.5 })
        const s = shiftOf(src, { x: 1.5, y: 1.5 })
        const r = pasteInto(dest, src, { x: d.x - s.x, y: d.y - s.y }, { onConflict: 'replace' })
        expect(dest.entities.valuesArray().map(e => e.name)).toEqual(['assembling-machine-2'])
        expect(r.conflicts[0].blockedBy[0]).toMatch(/^wooden-chest at /)
    })

    it('undoes a whole paste in one step', async () => {
        const unit = await basicBuilder()
        const dest = new Blueprint()
        pasteInto(dest, unit, { x: 0, y: 0 })
        dest.history.undo()
        expect(dest.entities.size).toBe(0)
        expect(dest.serialize().wires ?? []).toEqual([])
    })

    it('refuses offsets that leave the grid', () => {
        const chest = blueprint([{ name: 'wooden-chest', x: 0.5, y: 0.5 }])
        expect(() => pasteInto(new Blueprint(), chest, { x: 0.5, y: 0 })).toThrow(ParityError)
        const rail = blueprint([{ name: 'straight-rail', x: 1, y: 1 }])
        expect(() => pasteInto(new Blueprint(), rail, { x: 1, y: 0 })).toThrow(
            'the blueprint holds rails, which need an even offset'
        )
        expect(() => pasteInto(new Blueprint(), rail, { x: 2, y: 0 })).not.toThrow()
    })

    it('pastes tiles, and treats a different tile underneath as a collision', () => {
        const src = new Blueprint({
            entities: [],
            tiles: [{ name: 'stone-path', position: { x: 0, y: 0 } }],
        })
        const dest = new Blueprint()
        pasteInto(dest, src, { x: 0, y: 0 })
        expect(dest.tiles.size).toBe(1)
        // The same tile again is no conflict; a different one is.
        pasteInto(dest, src, { x: 0, y: 0 })
        const concrete = new Blueprint({
            entities: [],
            tiles: [{ name: 'concrete', position: { x: 0, y: 0 } }],
        })
        expect(() => pasteInto(dest, concrete, { x: 0, y: 0 })).toThrow(
            'tile stone-path in the way'
        )
    })
})
