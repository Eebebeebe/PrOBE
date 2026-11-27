import { beforeAll, describe, expect, it } from 'vite-plus/test'
import { Blueprint } from '../../packages/editor/src/core/Blueprint'
import { loadTestData } from '../helpers/load-test-data'

/*
    The size of a blueprint, as a script reads it (`bp.width`, `bp.height`) to
    paste blueprints side by side. It is the rectangle the entities' footprints
    and the tiles cover, in whole tiles. Every expected value below is worked
    out by hand from the prototypes' sizes: a chest is 1x1, an assembler 3x3,
    a steam engine 3x5 facing north.
*/
const at = (name: string, x: number, y: number, direction?: number) => ({
    name,
    position: { x, y },
    ...(direction === undefined ? {} : { direction }),
})

function blueprint(
    entities: ReturnType<typeof at>[],
    tiles: { name: string; position: { x: number; y: number } }[] = []
): Blueprint {
    return new Blueprint({
        entities: entities.map((e, i) => ({ entity_number: i + 1, ...e })),
        tiles,
    })
}

describe('Blueprint size', () => {
    beforeAll(loadTestData)

    it('is the footprint of a single entity', () => {
        expect(blueprint([at('wooden-chest', 0.5, 0.5)]).getBounds()).toMatchObject({
            width: 1,
            height: 1,
        })
        const am = blueprint([at('assembling-machine-2', 0.5, 0.5)])
        expect([am.width, am.height]).toEqual([3, 3])
    })

    it('spans every entity, gaps included', () => {
        // Chest on tile 0, assembler on tiles 2..4 (centre 3.5); rows -1..1.
        const bp = blueprint([at('wooden-chest', 0.5, 0.5), at('assembling-machine-2', 3.5, 0.5)])
        const b = bp.getBounds()
        expect([b.width, b.height]).toEqual([5, 3])
        expect(b.maxX - b.minX).toBe(5)
        expect(b.maxY - b.minY).toBe(3)
    })

    it('turns with the entity', () => {
        expect(blueprint([at('steam-engine', 0.5, 0.5)]).getBounds()).toMatchObject({
            width: 3,
            height: 5,
        })
        expect(blueprint([at('steam-engine', 0.5, 0.5, 4)]).getBounds()).toMatchObject({
            width: 5,
            height: 3,
        })
    })

    it('counts tiles', () => {
        const bp = blueprint(
            [at('wooden-chest', 0.5, 0.5)],
            [{ name: 'stone-path', position: { x: 5, y: 0 } }]
        )
        // Chest on tile 0, the tile on tile 5: six columns, one row.
        expect([bp.width, bp.height]).toEqual([6, 1])
    })

    it('leaves out entities placed off the grid', () => {
        // A land mine is placeable-off-grid; the chest alone decides the size.
        const bp = blueprint([at('wooden-chest', 0.5, 0.5), at('land-mine', 9.3, 4.7)])
        expect([bp.width, bp.height]).toEqual([1, 1])
    })

    it('rounds up to even sizes for the rail grid when asked', () => {
        const am = blueprint([at('assembling-machine-2', 0.5, 0.5)])
        expect(am.getBounds({ railParity: true })).toMatchObject({ width: 4, height: 4 })
        const rail = blueprint([at('straight-rail', 1, 1)])
        expect(rail.getBounds({ railParity: true })).toMatchObject({ width: 2, height: 2 })
    })

    it('is zero for an empty blueprint', () => {
        expect(new Blueprint().getBounds()).toEqual({
            minX: 0,
            minY: 0,
            maxX: 0,
            maxY: 0,
            width: 0,
            height: 0,
        })
    })
})
