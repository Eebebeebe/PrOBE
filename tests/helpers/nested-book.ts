import { packVersion } from './encode-blueprint'

/*
    The hand-built book that tests/book-serialize.spec.ts (browser) and
    tests/headless/book-serialize.test.ts (Node) both walk. See the spec for why
    it has this shape.
*/

const VERSION = packVersion(2, 0, 55)

/** A one-entity blueprint, identifiable by its label. */
const blueprint = (label: string): Record<string, unknown> => ({
    item: 'blueprint',
    version: VERSION,
    label,
    entities: [{ entity_number: 1, name: 'wooden-chest', position: { x: 0.5, y: 0.5 } }],
})

/*
    Flattened index -> label:

      entry 0  blueprint A            0
      entry 1  book                     entry 0  blueprint B    1
                                        entry 1  blueprint C    2
      entry 2  blueprint D            3

    Four blueprints across three top-level entries is the smallest shape where a
    flattened index differs from the top-level one in both directions, so an
    off-by-one in either conversion lands on the wrong blueprint.
*/
export const BOOK = {
    item: 'blueprint-book',
    version: VERSION,
    active_index: 0,
    label: 'outer',
    blueprints: [
        { index: 0, blueprint: blueprint('A') },
        {
            index: 1,
            blueprint_book: {
                item: 'blueprint-book',
                version: VERSION,
                active_index: 0,
                label: 'inner',
                blueprints: [
                    { index: 0, blueprint: blueprint('B') },
                    { index: 1, blueprint: blueprint('C') },
                ],
            },
        },
        { index: 2, blueprint: blueprint('D') },
    ],
}
