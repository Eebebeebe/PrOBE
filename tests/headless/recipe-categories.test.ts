import { afterEach, beforeAll, describe, expect, it } from 'vite-plus/test'
import type { RecipePrototype } from 'factorio:prototype'
import { Blueprint } from '../../packages/editor/src/core/Blueprint'
import FD, { recipeCategories } from '../../packages/editor/src/core/factorioData'
import { loadTestData } from '../helpers/load-test-data'

/*
    Factorio 2.1 replaced RecipePrototype.category (one string, default
    "crafting") with categories (a non-empty list, default {"crafting"}); a
    machine can craft a recipe when any of its categories is in the machine's
    crafting_categories. The editor read only `category`, so with 2.1 data every
    recipe looked like "crafting": assemblers accepted all 656 recipes and 14
    other machine types none. These tests use 2.1-shaped recipes, so they hold
    on the committed 2.0 data and on 2.1 data alike.
*/
const recipe = (r: Record<string, unknown>) =>
    ({ type: 'recipe', name: 'test', ...r }) as unknown as RecipePrototype

describe('recipeCategories', () => {
    it('reads the 2.1 categories list', () => {
        expect(recipeCategories(recipe({ categories: ['organic', 'crafting'] }))).toEqual([
            'organic',
            'crafting',
        ])
    })
    it('reads the 2.0 category field, with additional categories', () => {
        expect(recipeCategories(recipe({ category: 'smelting' }))).toEqual(['smelting'])
        expect(
            recipeCategories(
                recipe({ category: 'chemistry', additional_categories: ['cryogenics'] })
            )
        ).toEqual(['chemistry', 'cryogenics'])
    })
    it('defaults to crafting, as the game does', () => {
        expect(recipeCategories(recipe({}))).toEqual(['crafting'])
        expect(recipeCategories(recipe({ categories: [] }))).toEqual(['crafting'])
    })
})

describe('acceptedRecipes with 2.1-shaped recipes', () => {
    beforeAll(loadTestData)
    const injected = ['probe-test-organic-or-crafting', 'probe-test-smelting-only']
    afterEach(() => {
        for (const name of injected) Reflect.deleteProperty(FD.recipes, name)
    })

    const accepts = (machine: string, name: string): boolean => {
        const bp = new Blueprint({
            entities: [{ entity_number: 1, name: machine, position: { x: 1.5, y: 1.5 } }],
        })
        const entity = bp.entities.get(1)
        if (!entity) throw new Error(`${machine} was not created`)
        return entity.acceptedRecipes.includes(name)
    }

    it('lets a machine craft a recipe through any one of its categories', () => {
        FD.recipes[injected[0]] = recipe({ name: injected[0], categories: ['organic', 'crafting'] })
        FD.recipes[injected[1]] = recipe({ name: injected[1], categories: ['smelting'] })
        expect(accepts('assembling-machine-1', injected[0])).toBe(true) // through "crafting"
        expect(accepts('assembling-machine-1', injected[1])).toBe(false)
        expect(accepts('stone-furnace', injected[1])).toBe(true)
        expect(accepts('stone-furnace', injected[0])).toBe(false)
    })
})
