import { beforeAll, describe, expect, it } from 'vite-plus/test'
import { readFileSync } from 'fs'
import { Blueprint } from '../../packages/editor/src/core/Blueprint'
import { Book } from '../../packages/editor/src/core/Book'
import { decode } from '../../packages/editor/src/core/bpString'
import type { Entity } from '../../packages/editor/src/core/Entity'
import { IncompatibleUpgradeError } from '../../packages/editor/src/core/errors'
import { loadTestData } from '../helpers/load-test-data'

/*
    Entity.setName: the in-place swap upgrade_all is built on. It must do what
    the game's fast-replace does - and refuse, with a reason, wherever the game
    would refuse or something set on the entity would be lost.
*/
function entity(bp: Blueprint, n: number): Entity {
    const e = bp.entities.get(n)
    if (!e) throw new Error(`entity ${n} missing`)
    return e
}

async function basicBuilder(): Promise<Blueprint> {
    const book = await decode(
        readFileSync('tests/__fixtures__/books/basic-builder.txt', 'utf8').trim()
    )
    if (!(book instanceof Book)) throw new Error('expected the basic-builder book')
    return book.selectBlueprint(0)
}

function raw(bp: Blueprint, n: number): Record<string, unknown> {
    const e = (bp.serialize().entities ?? []).find(x => x.entity_number === n)
    if (!e) throw new Error(`entity ${n} not serialized`)
    return { ...e }
}

describe('Entity.setName', () => {
    beforeAll(loadTestData)

    it('downgrades an AM3 to an AM2, keeping recipe, modules and wires', async () => {
        const bp = await basicBuilder()
        // Entity 5 is an AM3 on logistic-science-pack with two productivity-module-2.
        const before = raw(bp, 5)
        const wiresBefore = bp.serialize().wires
        entity(bp, 5).setName('assembling-machine-2')
        const after = raw(bp, 5)
        expect(after.name).toBe('assembling-machine-2')
        expect({ ...after, name: before.name }).toEqual(before)
        expect(bp.serialize().wires).toEqual(wiresBefore)
    })

    it('undoes as one step', async () => {
        const bp = await basicBuilder()
        const before = JSON.stringify(bp.serialize())
        entity(bp, 5).setName('assembling-machine-2')
        bp.history.undo()
        expect(JSON.stringify(bp.serialize())).toBe(before)
    })

    it('refuses a machine with too few module slots', async () => {
        const bp = await basicBuilder()
        expect(() => entity(bp, 5).setName('assembling-machine-1')).toThrow(
            'Cannot turn assembling-machine-3 into assembling-machine-1: it has 0 module slots and slot 1 holds productivity-module-2'
        )
        // Nothing changed.
        expect(entity(bp, 5).name).toBe('assembling-machine-3')
    })

    it('refuses a machine that cannot craft the recipe', () => {
        const bp = new Blueprint({
            entities: [
                {
                    entity_number: 1,
                    name: 'assembling-machine-2',
                    position: { x: 0.5, y: 0.5 },
                    recipe: 'electric-engine-unit',
                },
            ],
        })
        expect(() => entity(bp, 1).setName('assembling-machine-1')).toThrow(
            'it cannot craft electric-engine-unit'
        )
    })

    it('refuses another fast-replace group', () => {
        const bp = new Blueprint({
            entities: [{ entity_number: 1, name: 'wooden-chest', position: { x: 0.5, y: 0.5 } }],
        })
        expect(() => entity(bp, 1).setName('assembling-machine-1')).toThrow(
            IncompatibleUpgradeError
        )
        expect(() => entity(bp, 1).setName('no-such-thing')).toThrow('there is no such entity')
    })

    it('keeps quality and circuit settings on a belt', () => {
        const control_behavior = {
            circuit_enabled: true,
            circuit_condition: {
                first_signal: { type: 'item', name: 'iron-plate' },
                constant: 5,
                comparator: '>',
            },
        }
        const bp = new Blueprint({
            entities: [
                {
                    entity_number: 1,
                    name: 'transport-belt',
                    position: { x: 0.5, y: 0.5 },
                    quality: 'rare',
                    control_behavior,
                } as never,
            ],
        })
        entity(bp, 1).setName('express-transport-belt')
        const out = raw(bp, 1)
        expect(out.name).toBe('express-transport-belt')
        expect(out.quality).toBe('rare')
        expect(out.control_behavior).toEqual(control_behavior)
    })
})

describe('Entity.setName on underground belts', () => {
    beforeAll(loadTestData)

    // Directions are 16ths: east is 4. Input at x=0, output `gap` tiles east.
    const pair = (name: string, gap: number, direction = 4) =>
        new Blueprint({
            entities: [
                { entity_number: 1, name, position: { x: 0.5, y: 0.5 }, direction, type: 'input' },
                {
                    entity_number: 2,
                    name,
                    position: { x: 0.5 + gap, y: 0.5 },
                    direction,
                    type: 'output',
                },
            ],
        })

    it('swaps both ends of a pair, keeping input and output', () => {
        const bp = pair('underground-belt', 4)
        entity(bp, 1).setName('express-underground-belt')
        expect([raw(bp, 1).name, raw(bp, 2).name]).toEqual([
            'express-underground-belt',
            'express-underground-belt',
        ])
        expect([raw(bp, 1).type, raw(bp, 2).type]).toEqual(['input', 'output'])
        bp.history.undo()
        expect([raw(bp, 1).name, raw(bp, 2).name]).toEqual(['underground-belt', 'underground-belt'])
    })

    it('refuses a tier that no longer reaches the partner', () => {
        // Express reaches 9 tiles, the basic underground 5: 7 apart is too far.
        const bp = pair('express-underground-belt', 7)
        expect(() => entity(bp, 1).setName('underground-belt')).toThrow(
            'its partner is 7 tiles away and underground-belt reaches 5'
        )
        expect([raw(bp, 1).name, raw(bp, 2).name]).toEqual([
            'express-underground-belt',
            'express-underground-belt',
        ])
    })
})
