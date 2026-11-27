import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import * as fs from 'fs'
import FD, { loadData } from '../../packages/editor/src/core/factorioData'
import { DATA_JSON, loadTestData } from '../helpers/load-test-data'

describe('loadData in Node', () => {
    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('loads the committed data without writing to the console', () => {
        const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(m =>
            vi.spyOn(console, m).mockImplementation(() => {})
        )
        // Called directly, not through loadTestData, which loads only once per file.
        loadData(fs.readFileSync(DATA_JSON, 'utf-8'))
        for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    })

    it('fills FD from data.json', () => {
        loadTestData()
        // 156 since 2.1 added landing-pad-unloading-bay
        expect(Object.keys(FD.entities)).toHaveLength(156)
        expect(FD.entities['assembling-machine-3']?.type).toBe('assembling-machine')
        expect(FD.recipes['logistic-science-pack']).toBeDefined()
    })

    it('gives splitters and undergrounds their own fast-replace groups', () => {
        loadTestData()
        expect(FD.entities['splitter']?.fast_replaceable_group).toBe('splitter')
        expect(FD.entities['underground-belt']?.fast_replaceable_group).toBe('underground-belt')
    })
})
