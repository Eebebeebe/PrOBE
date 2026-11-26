import * as fs from 'fs'
import * as path from 'path'
import { loadData } from '../../packages/editor/src/core/factorioData'

/*
    Loads the committed game data into the editor core's FD, the way the
    browser does it after fetching data.json, so Node tests can use the core.

    Resolved from the working directory like tests/wire-switch-completeness.test.ts
    does: the root tsconfig is `module: "ES6"`, so import.meta is unavailable.
    FD is module state, so loading once per test file is enough; repeat calls
    are no-ops.
*/
export const DATA_JSON = path.resolve(process.cwd(), 'packages/exporter/data/output/data.json')

let loaded = false

export function loadTestData(): void {
    if (loaded) return
    loadData(fs.readFileSync(DATA_JSON, 'utf-8'))
    loaded = true
}
