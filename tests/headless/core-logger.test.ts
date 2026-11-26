import { afterEach, beforeAll, describe, expect, it, vi } from 'vite-plus/test'
import { Blueprint, oilOutpostSettings } from '../../packages/editor/src/core/Blueprint'
import { decode } from '../../packages/editor/src/core/bpString'
import { coreSettings } from '../../packages/editor/src/core/config'
import { encodeBlueprint } from '../helpers/encode-blueprint'
import { loadTestData } from '../helpers/load-test-data'

/*
    The core's diagnostics go to coreSettings.logger, which defaults to the
    console (so the browser editor is unchanged). A Web Worker sandbox or a test
    can swap it to capture them; nothing may bypass it and hit the console.
*/
describe('the core logger', () => {
    beforeAll(loadTestData)
    afterEach(() => {
        coreSettings.logger = console
        oilOutpostSettings.DEBUG = false
        vi.restoreAllMocks()
    })

    function captureAll() {
        const consoleCalls = (['log', 'info', 'warn', 'error', 'debug'] as const).map(m =>
            vi.spyOn(console, m).mockImplementation(() => {})
        )
        const captured: { level: string; text: string }[] = []
        coreSettings.logger = {
            log: (...d) => captured.push({ level: 'log', text: d.map(String).join(' ') }),
            warn: (...d) => captured.push({ level: 'warn', text: d.map(String).join(' ') }),
            clear: () => {},
        }
        return { captured, consoleCalls }
    }

    // One known entity and one the game data has never heard of.
    const withUnknown = () =>
        encodeBlueprint({
            item: 'blueprint',
            version: 562949956239360,
            entities: [
                { entity_number: 1, name: 'wooden-chest', position: { x: 0.5, y: 0.5 } },
                { entity_number: 2, name: 'no-such-mod-entity', position: { x: 2.5, y: 0.5 } },
            ],
        })

    it('defaults to the console', () => {
        expect(coreSettings.logger).toBe(console)
    })

    it('routes decode warnings to a swapped-in logger and none to the console', async () => {
        const { captured, consoleCalls } = captureAll()

        const bp = await decode(withUnknown())
        if (!(bp instanceof Blueprint)) throw new Error('expected a blueprint')

        expect(bp.entities.valuesArray().map(e => e.name)).toEqual(['wooden-chest'])
        expect(captured.some(m => m.level === 'warn' && m.text.includes('unknown entit'))).toBe(
            true
        )
        for (const spy of consoleCalls) expect(spy).not.toHaveBeenCalled()
    })

    it('routes the oil outpost generator and its timers to a swapped-in logger', () => {
        const { captured, consoleCalls } = captureAll()
        const bp = new Blueprint({
            entities: [
                { entity_number: 1, name: 'pumpjack', position: { x: 1.5, y: 1.5 } },
                { entity_number: 2, name: 'pumpjack', position: { x: 10.5, y: 1.5 } },
            ],
        })

        bp.generatePipes()

        expect(captured.some(m => m.text.startsWith('Generating pipes'))).toBe(true)
        expect(captured.some(m => m.text.startsWith('Timer: Total generation finished in'))).toBe(
            true
        )
        for (const spy of consoleCalls) expect(spy).not.toHaveBeenCalled()
    })
})
