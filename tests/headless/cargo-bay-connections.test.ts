import { beforeAll, describe, expect, it } from 'vite-plus/test'
import { Blueprint } from '../../packages/editor/src/core/Blueprint'
import { getSpriteData, type IDrawData } from '../../packages/editor/src/core/spriteDataBuilder'
import { loadTestData } from '../helpers/load-test-data'

/*
    The cargo-bay connection walls of Factorio 2.1, which come from a
    `tileset` indexed by each tile's eight-neighbour bitmask. Expectations are
    worked out by hand from the game's own table
    (base/graphics/entity/cargo-hubs/connections/connections.lua), not from the
    drawing code: which tile of the joined structure gets which piece.

    Pieces are told apart by their frame in connections-0.png, which every
    piece's first layer uses: frame = row * 8 + column + 1 for 222x270 cells.
    Per the Lua: top wall 5-8, right 1-4, bottom 9-12, left 13-16, outer
    corners TL 19-20, TR 17-18, BL 23-24, BR 21-22, inner corners TL 27-28,
    TR 25-26, BL 31-32, BR 29-30.
*/
const PIECE: Record<number, string> = {}
const name = (label: string, frames: number[]) => frames.forEach(f => (PIECE[f] = label))
name('top', [5, 6, 7, 8])
name('right', [1, 2, 3, 4])
name('bottom', [9, 10, 11, 12])
name('left', [13, 14, 15, 16])
name('TL-out', [19, 20])
name('TR-out', [17, 18])
name('BL-out', [23, 24])
name('BR-out', [21, 22])
name('TL-in', [27, 28])
name('TR-in', [25, 26])
name('BL-in', [31, 32])
name('BR-in', [29, 30])

/** Each connection piece drawn for a blueprint, as "<piece>@<tile x>,<tile y>". */
function pieces(entities: { name: string; x: number; y: number }[]): string[] {
    const bp = new Blueprint({
        entities: entities.map((e, i) => ({
            entity_number: i + 1,
            name: e.name,
            position: { x: e.x, y: e.y },
        })),
    })
    const out: string[] = []
    for (const entity of bp.entities.values()) {
        const data = {
            dir: entity.direction,
            name: entity.name,
            positionGrid: bp.entityPositionGrid,
            position: entity.position,
            generateConnector: false,
            displayPanelIcon: undefined,
            assemblerHasFluidInputs: false,
            assemblerHasFluidOutputs: false,
            dirType: undefined,
            selectorCombinatorSelectMax: false,
            operator: undefined,
            railLayer: undefined,
            trainStopColor: undefined,
            modules: [],
        } satisfies IDrawData
        for (const s of getSpriteData(data)) {
            if (!/connections-0\.png$/.test(s.filename ?? '')) continue
            const frame = ((s.y ?? 0) / 270) * 8 + (s.x ?? 0) / 222 + 1
            // The tile the piece was shifted to, relative to the blueprint.
            const [sx, sy] = Array.isArray(s.shift) ? s.shift : [0, 0]
            const tx = Math.floor(entity.position.x + sx - 2.5 / 32)
            const ty = Math.floor(entity.position.y + sy + 1 / 32)
            out.push(`${PIECE[frame] ?? `frame${frame}`}@${tx},${ty}:${entity.name}`)
        }
    }
    return out.sort()
}

const kinds = (list: string[]) => list.map(p => p.split('@')[0]).sort()

describe('cargo bay connection walls (2.1 tileset)', () => {
    beforeAll(loadTestData)

    it('outlines a lone bay: four outer corners, two wall pieces per side, an empty middle', () => {
        const got = pieces([{ name: 'cargo-bay', x: 0, y: 0 }])
        expect(kinds(got)).toEqual(
            [
                'BL-out',
                'BR-out',
                'TL-out',
                'TR-out',
                'top',
                'top',
                'bottom',
                'bottom',
                'left',
                'left',
                'right',
                'right',
            ].sort()
        )
    })

    it('joins two bays side by side into one outline, with no wall between them', () => {
        const got = pieces([
            { name: 'cargo-bay', x: 0, y: 0 },
            { name: 'cargo-bay', x: 4, y: 0 },
        ])
        // An 8x4 outline: 4 corners, 6 top, 6 bottom, 2 left, 2 right.
        expect(kinds(got)).toEqual(
            [
                ...['BL-out', 'BR-out', 'TL-out', 'TR-out'],
                ...Array(6).fill('top'),
                ...Array(6).fill('bottom'),
                ...Array(2).fill('left'),
                ...Array(2).fill('right'),
            ].sort()
        )
    })

    it('draws an inner corner where three bays make an L', () => {
        const got = pieces([
            { name: 'cargo-bay', x: 0, y: 0 },
            { name: 'cargo-bay', x: 4, y: 0 },
            { name: 'cargo-bay', x: 0, y: 4 },
        ])
        expect(kinds(got).filter(k => k.endsWith('-in'))).toEqual(['BR-in'])
        // An L has five convex corners and one concave one.
        expect(kinds(got).filter(k => k.endsWith('-out'))).toEqual(
            ['BL-out', 'BR-out', 'BR-out', 'TL-out', 'TR-out'].sort()
        )
    })

    it('treats the platform hub as part of the structure a bay joins', () => {
        // A bay against the top half of the hub's right edge (hub 8x8 at the
        // origin, bay 4x4 one tile row up from the hub's top).
        const ofBay = (list: string[]) => kinds(list.filter(p => p.endsWith(':cargo-bay')))
        const alone = ofBay(pieces([{ name: 'cargo-bay', x: 6, y: -2 }]))
        const joined = ofBay(
            pieces([
                { name: 'space-platform-hub', x: 0, y: 0 },
                { name: 'cargo-bay', x: 6, y: -2 },
            ])
        )
        expect(alone).toContain('left')
        expect(alone).toContain('TL-out')
        expect(alone).toContain('BL-out')
        // Joined, the bay's left side is inside the structure.
        expect(joined).not.toContain('left')
        expect(joined).not.toContain('TL-out')
        expect(joined).not.toContain('BL-out')
        // The hub draws its own outline from the same tileset.
        const hub = kinds(
            pieces([{ name: 'space-platform-hub', x: 0, y: 0 }]).filter(p =>
                p.endsWith(':space-platform-hub')
            )
        )
        expect(hub.filter(k => k.endsWith('-out'))).toEqual([
            'BL-out',
            'BR-out',
            'TL-out',
            'TR-out',
        ])
        expect(hub.filter(k => k === 'top')).toHaveLength(6)
    })
})
