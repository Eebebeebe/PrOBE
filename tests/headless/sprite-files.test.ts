import { describe, expect, it } from 'vite-plus/test'
import * as fs from 'fs'
import * as path from 'path'
import { DATA_JSON } from '../helpers/load-test-data'

/*
    The exporter turns every "*.png" path quoted in data.json into
    data/output/<same path>.basis, and the editor fetches exactly those files.
    So the two must match one to one: a reference without a file draws blank
    (one console error per sprite), and a file without a reference is dead
    weight in the repository and the website build - left behind when the
    game drops a sprite, because the exporter never deletes old output.
*/
const OUTPUT = path.dirname(DATA_JSON)

const referenced = new Set(
    [...fs.readFileSync(DATA_JSON, 'utf-8').matchAll(/"([^"]+?\.png)"/g)].map(m =>
        m[1].replace(/\.png$/, '.basis')
    )
)

function basisFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => {
        const p = path.join(dir, d.name)
        if (d.isDirectory()) return basisFiles(p)
        return d.name.endsWith('.basis') ? [path.relative(OUTPUT, p)] : []
    })
}
const onDisk = new Set(basisFiles(OUTPUT))

describe('sprite files match data.json', () => {
    it('has a .basis for every png data.json references', () => {
        expect([...referenced].filter(f => !onDisk.has(f)).sort()).toEqual([])
    })

    it('has no .basis that data.json no longer references', () => {
        expect([...onDisk].filter(f => !referenced.has(f)).sort()).toEqual([])
    })

    it('is asking about a real set', () => {
        expect(referenced.size).toBeGreaterThan(3000)
    })
})
