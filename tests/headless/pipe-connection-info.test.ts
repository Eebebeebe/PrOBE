import { beforeAll, describe, expect, it } from 'vite-plus/test'
import FD, {
    getFluidBoxes,
    shownPipeConnections,
} from '../../packages/editor/src/core/factorioData'
import { loadTestData } from '../helpers/load-test-data'

/*
    Which pipe connections get an info arrow in the entity overlay. Factorio
    2.1 moved `hide_connection_info` from the fluid box onto each pipe
    connection, so reading only the box drew arrows on every pipe and tank and
    on the hidden input side of pumps and valves.
*/
const shown = (name: string) =>
    getFluidBoxes(FD.entities[name], false).flatMap(fb =>
        shownPipeConnections(fb).map(c => c.flow_direction ?? 'input-output')
    )

describe('shownPipeConnections', () => {
    beforeAll(loadTestData)

    it('hides every connection of pipes and tanks', () => {
        for (const name of ['pipe', 'pipe-to-ground', 'storage-tank', 'infinity-pipe']) {
            expect(shown(name), name).toEqual([])
        }
    })

    it('shows only the output side of a pump and of the valves', () => {
        for (const name of ['pump', 'overflow-valve', 'top-up-valve', 'one-way-valve']) {
            expect(shown(name), name).toEqual(['output'])
        }
    })

    it('still shows the connections nothing hides (control)', () => {
        // A chemical plant has two inputs and two outputs, none hidden.
        expect(shown('chemical-plant').sort()).toEqual(['input', 'input', 'output', 'output'])
    })

    it('honours the 2.0 flag on the whole fluid box too', () => {
        const pumpBox = getFluidBoxes(FD.entities['pump'], false)[0]
        expect(shownPipeConnections({ ...pumpBox, hide_connection_info: true })).toEqual([])
    })
})
