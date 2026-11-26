import { describe, expect, it } from 'vite-plus/test'
import type { EntityWithOwnerPrototype } from 'factorio:prototype'
import {
    getCircuitConnector,
    getMaxWireDistance,
} from '../../packages/editor/src/core/factorioData'

/*
    Factorio 2.1 changed where circuit wires attach:
      - containers (chests, infinity and proxy containers) store their single
        connector as a one-entry list instead of one object;
      - labs and land mines gained one connector, boilers (and heat exchangers)
        and pipe-to-ground one per facing (N, E, S, W);
      - all of these, plus pipes and heat pipes, gained circuit_wire_max_distance.
    Without these arms a wired chest or boiler has no connection point, which
    throws inside initBP and loses the whole blueprint. Synthetic prototypes in
    both shapes, so this holds on 2.0 and 2.1 data alike. Pipes and heat pipes
    pick their connector by neighbour mask and are covered separately.
*/
const point = (x: number) => ({ points: { wire: { red: [x, 0], green: [x, 1] } } })
const proto = (type: string, extra: Record<string, unknown>) =>
    ({ type, name: `test-${type}`, ...extra }) as unknown as EntityWithOwnerPrototype
const connector = (e: EntityWithOwnerPrototype, dir = 0) =>
    getCircuitConnector(
        e,
        dir,
        () => false,
        () => 0
    )

describe('circuit connectors in 2.1 shapes', () => {
    it('reads a container connector as one object (2.0) or a one-entry list (2.1)', () => {
        for (const type of [
            'container',
            'logistic-container',
            'infinity-container',
            'proxy-container',
        ]) {
            expect(connector(proto(type, { circuit_connector: point(1) }))).toEqual(point(1))
            for (const dir of [0, 4, 8, 12]) {
                expect(connector(proto(type, { circuit_connector: [point(2)] }), dir)).toEqual(
                    point(2)
                )
            }
        }
    })

    it('gives labs and land mines their single connector in every direction', () => {
        for (const type of ['lab', 'land-mine']) {
            for (const dir of [0, 4, 8, 12]) {
                expect(connector(proto(type, { circuit_connector: point(3) }), dir)).toEqual(
                    point(3)
                )
            }
        }
    })

    it('picks the boiler and pipe-to-ground connector by facing', () => {
        for (const type of ['boiler', 'pipe-to-ground']) {
            const e = proto(type, {
                circuit_connector: [point(10), point(11), point(12), point(13)],
            })
            expect([0, 4, 8, 12].map(dir => connector(e, dir))).toEqual([
                point(10),
                point(11),
                point(12),
                point(13),
            ])
        }
    })

    it('reads the wire reach of every type that gained one', () => {
        for (const type of [
            'boiler',
            'pipe',
            'infinity-pipe',
            'pipe-to-ground',
            'heat-pipe',
            'lab',
            'land-mine',
        ]) {
            expect(getMaxWireDistance(proto(type, { circuit_wire_max_distance: 9 }))).toBe(9)
            expect(getMaxWireDistance(proto(type, {}))).toBe(0)
        }
    })
})
