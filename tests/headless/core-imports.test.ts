import { describe, expect, it } from 'vite-plus/test'
import * as fs from 'fs'
import * as path from 'path'

/*
    packages/editor/src/core is the model: blueprints, books, entities, the
    string codec. PrOBE's scripting engine has to run it in plain Node, in a
    Web Worker and in Docker, none of which has PixiJS or a DOM. So core may
    not reach the rendering side of the editor.

    This is a ratchet. KNOWN_VIOLATIONS lists the imports that still break the
    rule; each Phase 2 step removes entries until it is empty. The test fails
    in both directions:
      - a forbidden import that is not listed (someone added coupling back), and
      - a listed import that no longer exists (a step removed it, so the list
        must shrink with it and can never grow back unnoticed).

    Entries are "file -> specifier" rather than line numbers, so unrelated
    edits above an import do not break the test.
*/

const CORE = path.resolve(process.cwd(), 'packages/editor/src/core')

/** Relative imports that leave core but are pure, and therefore allowed. */
const ALLOWED_OUTSIDE_CORE = new Set(['../types', '../common/util'])

/** Package imports core may never use. */
const FORBIDDEN_PACKAGES = [/^pixi\.js(\/|$)/, /^@pixi\//]

const KNOWN_VIOLATIONS = new Set([
    'Blueprint.ts -> pixi.js',
    'Blueprint.ts -> ../common/globals',
    'Entity.ts -> ../common/globals',
    'bpString.ts -> ../common/globals',
])

function sourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => {
        const full = path.join(dir, d.name)
        if (d.isDirectory()) return sourceFiles(full)
        return d.name.endsWith('.ts') && !d.name.endsWith('.test.ts') ? [full] : []
    })
}

/** Every module specifier in `import ... from '...'`, `export ... from '...'`, `import '...'` and `import('...')`. */
function importSpecifiers(source: string): string[] {
    const re =
        /\b(?:import|export)\s[^'"]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g
    return [...source.matchAll(re)].map(m => m[1] ?? m[2] ?? m[3])
}

/** Whether `spec`, imported from `file`, breaks the headless rule. */
function isForbidden(file: string, spec: string): boolean {
    if (FORBIDDEN_PACKAGES.some(re => re.test(spec))) return true
    if (!spec.startsWith('.')) return false
    const target = path.resolve(path.dirname(file), spec)
    if (target === CORE || target.startsWith(CORE + path.sep)) return false
    const fromCoreRoot = path.relative(CORE, target).split(path.sep).join('/')
    return !ALLOWED_OUTSIDE_CORE.has(fromCoreRoot)
}

function violations(): string[] {
    return sourceFiles(CORE).flatMap(file => {
        const rel = path.relative(CORE, file).split(path.sep).join('/')
        return importSpecifiers(fs.readFileSync(file, 'utf-8'))
            .filter(spec => isForbidden(file, spec))
            .map(spec => `${rel} -> ${spec}`)
    })
}

describe('core stays headless', () => {
    it('has no forbidden import outside the known list', () => {
        const unexpected = violations().filter(v => !KNOWN_VIOLATIONS.has(v))
        expect(unexpected, 'core must not import pixi.js, globals, containers/ or UI/').toEqual([])
    })

    it('lists no violation that is already gone (the list only shrinks)', () => {
        const found = new Set(violations())
        const stale = [...KNOWN_VIOLATIONS].filter(v => !found.has(v))
        expect(stale, 'remove these from KNOWN_VIOLATIONS').toEqual([])
    })

    // The checker itself, so a regex slip cannot turn the ratchet into a no-op.
    describe('the checker', () => {
        const coreFile = path.join(CORE, 'Example.ts')
        it('finds every import form', () => {
            const src = [
                "import G from '../common/globals'",
                "import { A,\n  B } from 'pixi.js'",
                "export { C } from '../containers/X'",
                "import '../UI/side-effect'",
                "const m = await import('../Editor')",
                "import type { T } from '../types'",
            ].join('\n')
            expect(importSpecifiers(src)).toEqual([
                '../common/globals',
                'pixi.js',
                '../containers/X',
                '../UI/side-effect',
                '../Editor',
                '../types',
            ])
        })
        it('classifies specifiers', () => {
            expect(isForbidden(coreFile, 'pixi.js')).toBe(true)
            expect(isForbidden(coreFile, '@pixi/core')).toBe(true)
            expect(isForbidden(coreFile, '../common/globals')).toBe(true)
            expect(isForbidden(coreFile, '../containers/PaintContainer')).toBe(true)
            expect(isForbidden(coreFile, '../UI/Dialog')).toBe(true)
            expect(isForbidden(coreFile, './Blueprint')).toBe(false)
            expect(isForbidden(coreFile, './generators/util')).toBe(false)
            expect(isForbidden(coreFile, '../types')).toBe(false)
            expect(isForbidden(coreFile, '../common/util')).toBe(false)
            expect(isForbidden(coreFile, 'pako')).toBe(false)
            expect(isForbidden(path.join(CORE, 'generators', 'g.ts'), '../../common/globals')).toBe(
                true
            )
        })
    })
})
