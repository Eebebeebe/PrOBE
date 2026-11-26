import { afterEach, beforeAll, describe, expect, it, vi } from 'vite-plus/test'
import { Blueprint } from '../../packages/editor/src/core/Blueprint'
import { coreSettings } from '../../packages/editor/src/core/config'
import { loadTestData } from '../helpers/load-test-data'

/*
    The debug flag used to live on the `G` globals, which pull in PixiJS. The
    core now reads it from coreSettings; Editor.debug writes it there.
*/
describe('the core debug setting', () => {
    beforeAll(loadTestData)
    afterEach(() => {
        coreSettings.debug = false
        vi.restoreAllMocks()
    })

    it('is off by default and keeps history logging off', () => {
        expect(coreSettings.debug).toBe(false)
        expect(new Blueprint().history.logging).toBe(false)
    })

    it('turns on history logging for blueprints created while it is on', () => {
        coreSettings.debug = true
        expect(new Blueprint().history.logging).toBe(true)
    })
})
