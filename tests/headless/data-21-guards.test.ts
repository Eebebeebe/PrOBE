import { beforeAll, describe, expect, it, vi } from 'vite-plus/test'
import * as zlib from 'zlib'
import type { ModulePrototype } from 'factorio:prototype'
import { decode } from '../../packages/editor/src/core/bpString'
import { coreSettings } from '../../packages/editor/src/core/config'
import FD, {
    getPossibleRotations,
    recipeSupportsModule,
} from '../../packages/editor/src/core/factorioData'
import { loadTestData } from '../helpers/load-test-data'

/*
    Two small 2.1 adjustments that the corpus fixed points cannot see on their
    own: the blueprint schema learned the decider combinator's `else_outputs`,
    and the module check stopped throwing on recipe names the data lacks.
*/

const encodeRaw = (obj: unknown): string =>
    '0' + zlib.deflateSync(Buffer.from(JSON.stringify(obj))).toString('base64')

const deciderBlueprint = (conditions: Record<string, unknown>) => ({
    blueprint: {
        item: 'blueprint',
        version: 562954250027008, // 2.1.25
        icons: [{ index: 1, signal: { name: 'decider-combinator' } }],
        entities: [
            {
                entity_number: 1,
                name: 'decider-combinator',
                position: { x: 0.5, y: 1 },
                control_behavior: { decider_conditions: conditions },
            },
        ],
    },
})

const outputs = [{ signal: { type: 'virtual', name: 'signal-V' }, copy_count_from_input: false }]
const condition = [{ first_signal: { name: 'jellynut' }, comparator: '=' }]

async function warningsFor(str: string): Promise<string[]> {
    const warn = vi.spyOn(coreSettings.logger, 'warn').mockImplementation(() => {})
    try {
        await decode(str)
        return warn.mock.calls.map(c => c.map(String).join(' '))
    } finally {
        warn.mockRestore()
    }
}

describe('Factorio 2.1 data guards', () => {
    beforeAll(loadTestData)

    it('accepts a decider combinator with else_outputs without a warning', async () => {
        const str = encodeRaw(
            deciderBlueprint({ conditions: condition, outputs, else_outputs: outputs })
        )
        expect(await warningsFor(str)).toEqual([])
    })

    it('still warns about a key the schema does not know (control)', async () => {
        const str = encodeRaw(
            deciderBlueprint({ conditions: condition, outputs, not_a_real_key: outputs })
        )
        const warnings = await warningsFor(str)
        expect(warnings.some(w => w.includes('not_a_real_key'))).toBe(true)
    })

    it('lets modules through for a recipe the data does not know', () => {
        const speed = FD.items['speed-module'] as unknown as ModulePrototype
        expect(speed.type).toBe('module')
        expect(() => recipeSupportsModule('no-such-recipe', speed)).not.toThrow()
        expect(recipeSupportsModule('no-such-recipe', speed)).toBe(true)
    })

    it('still applies a known recipe restriction (control)', () => {
        // Productivity modules only work on recipes that allow productivity.
        const prod = FD.items['productivity-module'] as unknown as ModulePrototype
        expect(recipeSupportsModule('iron-gear-wheel', prod)).toBe(true)
        expect(recipeSupportsModule('assembling-machine-1', prod)).toBe(false)
    })

    it('rotates steam engines and turbines two ways, as 2.1 declares', () => {
        expect(getPossibleRotations(FD.entities['steam-engine'])).toEqual([0, 4])
        expect(getPossibleRotations(FD.entities['steam-turbine'])).toEqual([0, 4])
        // 2.1 also made the flamethrower turret 8-way, through its flags.
        expect(getPossibleRotations(FD.entities['flamethrower-turret'])).toEqual([
            0, 2, 4, 6, 8, 10, 12, 14,
        ])
        // Control: an ordinary 4-way entity is untouched.
        expect(getPossibleRotations(FD.entities['assembling-machine-2'], true)).toEqual([
            0, 4, 8, 12,
        ])
    })
})
