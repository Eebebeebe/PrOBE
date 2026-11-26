import { describe, expect, it } from 'vite-plus/test'
import { spawnSync } from 'child_process'
import * as path from 'path'

/*
    Type-checks packages/editor/src/core with packages/editor/tsconfig.core.json,
    which leaves out the DOM library: core code that reaches for window,
    document, fetch or any other browser-only global fails here. It runs under
    `vp test` so the Docker image and CI enforce it without a separate step.
*/
describe('the core type-checks without the DOM library', () => {
    it('has no errors under tsconfig.core.json', () => {
        const tsc = path.resolve(process.cwd(), 'node_modules/.bin/tsc')
        const res = spawnSync(
            tsc,
            ['--noEmit', '--pretty', 'false', '-p', 'packages/editor/tsconfig.core.json'],
            {
                encoding: 'utf-8',
            }
        )
        expect(res.error).toBeUndefined()
        expect(res.stdout + res.stderr).toBe('')
        expect(res.status).toBe(0)
    }, 120_000)
})
