import { beforeAll, describe, expect, it } from 'vite-plus/test'
import { readFileSync } from 'fs'
import { Blueprint } from '../../packages/editor/src/core/Blueprint'
import { Book } from '../../packages/editor/src/core/Book'
import { decode } from '../../packages/editor/src/core/bpString'
import type { Entity } from '../../packages/editor/src/core/Entity'
import { InvalidQualityError, InvalidRecipeError } from '../../packages/editor/src/core/errors'
import FD from '../../packages/editor/src/core/factorioData'
import { loadTestData } from '../helpers/load-test-data'

/*
    Quality on entities and recipes. The conventions are the game's own,
    counted in test-blueprints/: an entity's quality is never written for
    'normal' (2991 rare and 144 legendary entities, no normal one), while
    recipe_quality is written with every recipe, 'normal' included (9320).
*/
function one(raw: Record<string, unknown>): { bp: Blueprint; e: Entity } {
    const bp = new Blueprint({
        entities: [{ entity_number: 1, position: { x: 0.5, y: 0.5 }, ...raw } as never],
    })
    const e = bp.entities.get(1)
    if (!e) throw new Error('entity missing')
    return { bp, e }
}
const out = (bp: Blueprint): Record<string, unknown> => ({ ...(bp.serialize().entities ?? [])[0] })

describe('Entity quality', () => {
    beforeAll(loadTestData)

    it('knows the qualities from data.json', () => {
        const visible = Object.values(FD.qualities)
            .filter(q => q.hidden !== true)
            .sort((a, b) => (a.level ?? 0) - (b.level ?? 0))
            .map(q => q.name)
        expect(visible).toEqual(['normal', 'uncommon', 'rare', 'epic', 'legendary'])
    })

    it('reads normal when absent and writes nothing for it', () => {
        const { bp, e } = one({ name: 'assembling-machine-2' })
        expect(e.quality).toBe('normal')
        e.quality = 'rare'
        expect(out(bp).quality).toBe('rare')
        e.quality = 'normal'
        expect('quality' in out(bp)).toBe(false)
    })

    it('refuses names that are not a quality a player can pick', () => {
        const { e } = one({ name: 'assembling-machine-2' })
        expect(() => (e.quality = 'legendery')).toThrow(InvalidQualityError)
        expect(() => (e.quality = 'quality-unknown')).toThrow('quality-unknown is not a quality')
        expect(e.quality).toBe('normal')
    })

    it('reads the quality of real legendary entities', async () => {
        // 443 entities, 61 of them legendary, exported by the game.
        const raw = readFileSync('test-blueprints/JEPAKAZOL/space-platform-factory.txt', 'utf8')
        const book = await decode(raw.replace(/\s/g, ''))
        if (!(book instanceof Book)) throw new Error('expected a book')
        const path = book.findByLabel('Legendary Space Parts')
        if (!path) throw new Error('blueprint not found')
        const counts: Record<string, number> = {}
        for (const e of book.getBlueprint(path).entities.values()) {
            counts[e.quality] = (counts[e.quality] ?? 0) + 1
        }
        expect(counts.legendary).toBe(61)
        expect(Object.keys(counts).sort((a, b) => a.localeCompare(b))).toEqual([
            'legendary',
            'normal',
        ])
    })
})

describe('recipe quality and setRecipe', () => {
    beforeAll(loadTestData)

    it('has no recipe quality without a recipe, and refuses one', () => {
        const { e } = one({ name: 'assembling-machine-2' })
        expect(e.recipeQuality).toBeUndefined()
        expect(() => (e.recipeQuality = 'rare')).toThrow('has no recipe to give a quality')
    })

    it('sets recipe and quality together, and undoes them as one step', () => {
        const { bp, e } = one({ name: 'assembling-machine-2' })
        e.setRecipe('iron-gear-wheel', 'legendary')
        expect(out(bp)).toMatchObject({ recipe: 'iron-gear-wheel', recipe_quality: 'legendary' })
        bp.history.undo()
        expect(e.recipe).toBeUndefined()
        expect(e.recipeQuality).toBeUndefined()
    })

    it('drops a recipe quality picked for another recipe', () => {
        const { bp, e } = one({
            name: 'assembling-machine-2',
            recipe: 'iron-gear-wheel',
            recipe_quality: 'epic',
        })
        expect(e.recipeQuality).toBe('epic')
        e.recipe = 'copper-cable'
        expect('recipe_quality' in out(bp)).toBe(false)
        expect(e.recipeQuality).toBe('normal')
    })

    it('refuses a recipe the machine cannot craft, or one that does not exist', () => {
        const { e } = one({ name: 'assembling-machine-1' })
        expect(() => e.setRecipe('electric-engine-unit')).toThrow(
            'assembling-machine-1 cannot use recipe electric-engine-unit: it cannot craft it'
        )
        expect(() => e.setRecipe('no-such-recipe')).toThrow('there is no such recipe')
        expect(() => e.setRecipe('iron-gear-wheel', 'shiny')).toThrow(InvalidQualityError)
        expect(e.recipe).toBeUndefined()
    })

    it('refuses a recipe its modules do not work with, instead of removing them', () => {
        // Productivity modules only work on intermediate products; a chest is not one.
        const { bp, e } = one({
            name: 'assembling-machine-3',
            recipe: 'iron-gear-wheel',
            items: [
                {
                    id: { name: 'productivity-module-2' },
                    items: { in_inventory: [{ inventory: 4, stack: 0 }] },
                },
            ],
        })
        const before = JSON.stringify(out(bp))
        expect(() => e.setRecipe('iron-chest')).toThrow(InvalidRecipeError)
        expect(() => e.setRecipe('iron-chest')).toThrow('does not work with productivity-module-2')
        expect(JSON.stringify(out(bp))).toBe(before)
    })

    it('copies the recipe quality along with the recipe when pasting settings', () => {
        const bp = new Blueprint({
            entities: [
                {
                    entity_number: 1,
                    name: 'assembling-machine-2',
                    position: { x: 0.5, y: 0.5 },
                    recipe: 'iron-gear-wheel',
                    recipe_quality: 'rare',
                },
                { entity_number: 2, name: 'assembling-machine-3', position: { x: 4.5, y: 0.5 } },
            ],
        })
        const [source, target] = [bp.entities.get(1), bp.entities.get(2)]
        if (!source || !target) throw new Error('entities missing')
        target.pasteSettings(source)
        expect([target.recipe, target.recipeQuality]).toEqual(['iron-gear-wheel', 'rare'])
    })
})
