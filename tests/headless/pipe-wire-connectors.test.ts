import { beforeAll, describe, expect, it } from 'vite-plus/test'
import type { EntityWithOwnerPrototype } from 'factorio:prototype'
import { Blueprint } from '../../packages/editor/src/core/Blueprint'
import { getCircuitConnector } from '../../packages/editor/src/core/factorioData'
import { getPipeWireConnectionIndex } from '../../packages/editor/src/core/spriteDataBuilder'
import { loadTestData } from '../helpers/load-test-data'

/*
    In Factorio 2.1 pipes, infinity pipes and heat pipes take circuit wires.
    Their 16 connectors are indexed by which neighbours the piece connects to,
    as a bitmask N=1, E=2, S=4, W=8 (HeatPipePrototype.circuit_connector in the
    2.1 API; pipe follows the same pattern in
    core/lualib/circuit-connector-generated-definitions.lua), not by direction.
*/
describe('pipe and heat-pipe wire connectors', () => {
    beforeAll(loadTestData)

    it('picks the connector at the neighbour mask', () => {
        const cc = Array.from({ length: 16 }, (_, i) => ({
            points: { wire: { red: [i, 0], green: [i, 1] } },
        }))
        for (const type of ['pipe', 'infinity-pipe', 'heat-pipe']) {
            const e = {
                type,
                name: `test-${type}`,
                circuit_connector: cc,
            } as unknown as EntityWithOwnerPrototype
            for (const mask of [0, 5, 10, 15]) {
                expect(
                    getCircuitConnector(
                        e,
                        0,
                        () => false,
                        () => 0,
                        () => mask
                    )
                ).toBe(cc[mask])
            }
        }
    })

    const mask = (entities: { name: string; x: number; y: number }[], at: number) => {
        const bp = new Blueprint({
            entities: entities.map((e, i) => ({
                entity_number: i + 1,
                name: e.name,
                position: { x: e.x, y: e.y },
            })),
        })
        const entity = bp.entities.get(at)
        if (!entity) throw new Error('entity missing')
        return getPipeWireConnectionIndex(bp.entityPositionGrid, entity.position, entity.type)
    }

    it('computes the mask from fluid connections for a line of pipes', () => {
        const line = [0, 1, 2].map(y => ({ name: 'pipe', x: 0.5, y: y + 0.5 }))
        expect(mask(line, 1)).toBe(4) // top: connects south
        expect(mask(line, 2)).toBe(1 + 4) // middle: north and south
        expect(mask(line, 3)).toBe(1) // bottom: connects north
        expect(mask([{ name: 'pipe', x: 0.5, y: 0.5 }], 1)).toBe(0) // alone
    })

    it('computes the mask from heat connections for a heat-pipe junction', () => {
        const cross = [
            { name: 'heat-pipe', x: 1.5, y: 1.5 },
            { name: 'heat-pipe', x: 1.5, y: 0.5 },
            { name: 'heat-pipe', x: 2.5, y: 1.5 },
            { name: 'heat-pipe', x: 0.5, y: 1.5 },
        ]
        expect(mask(cross, 1)).toBe(1 + 2 + 8) // N, E and W, but nothing south
    })
})
