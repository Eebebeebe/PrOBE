import { describe, expect, it, vi } from 'vite-plus/test'
import * as core from '../../packages/editor/src/core/index'

/*
    The import ratchet reads source text; this proves the same thing at run
    time. pixi.js is replaced by a module that throws the moment anything loads
    it, then the core entry point is imported (vi.mock is hoisted above the
    imports). Any path - direct, transitive or through an import cycle - that
    reaches pixi.js fails this file before a test runs.
*/
vi.mock('pixi.js', () => {
    throw new Error('the headless core loaded pixi.js')
})

describe('the core entry point', () => {
    it('loads without pixi.js', () => {
        expect(typeof core.Blueprint).toBe('function')
        expect(typeof core.decode).toBe('function')
        expect(typeof core.loadData).toBe('function')
    })
})
