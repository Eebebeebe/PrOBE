/*
    Can PrOBE keep a user's JavaScript in a blueprint labelled "#code" inside a
    book so that it can be edited BOTH in PrOBE's browser editor and inside the
    game?

    The design under test: a row (or a grid) of N constant combinators, each
    holding one chunk of the code in its `player_description` (the in-game
    "comment" field, capped at 500 UTF-8 bytes - see fixtures/text-limits.json),
    the code split at line boundaries; the first combinator additionally carries
    entity `tags` {probe_code: <whole code>, probe_hash: sha256(concat(chunks))}.
    Tags have no limit but are a mod-only field; player_description is what a
    player can see and edit in the game.

    What this asks, for N = 1, 3 and 12 and a realistic ~5 KB program (umlauts,
    emoji, tabs, quotes, backslashes, CRLF lines, one line longer than 500
    bytes):

      Q1. import_stack -> export_stack of the whole book: every chunk and the
          tags exact? Does the export keep the entity array order and the
          entity_numbers, or does the game renumber / reorder (by position?)
      Q2. Build the "#code" blueprint into the world (build_blueprint forced +
          revive, and separately surface.create_entity with player_description,
          created in a shuffled order), re-capture with create_blueprint: are
          the descriptions exact, are the tags gone, are relative positions
          kept, and what entity_number order does the capture have - position,
          creation order (unit_number), or something else?
      Q3. Same, built at an odd offset and rotated (build_blueprint
          `direction`), plus a simulated horizontal / vertical flip, made with
          create_entity at mirrored positions, captured with a different area
          origin. Is "sort by y then x after undoing the rotation" still the
          chunk order?

          Correction, found when this was verified: build_blueprint DOES take
          `flip_horizontal` / `flip_vertical` in 2.1 (this script passed
          `mirror`, which the API silently ignores, as it ignores any unknown
          key). Real flips, measured separately, match the simulated shape: a
          horizontal flip reverses a row with no marker left behind, and a
          vertical flip turns every combinator to direction 8, the same as a
          180-degree rotation. So geometry alone cannot recover chunk order;
          PrOBE numbers its chunks instead.
      Q4. Edit one chunk in the world through LuaEntity.combinator_description
          (what the GUI writes), recapture: does only that chunk change, so a
          hash mismatch detects "edited in game"? And an over-long edit?
      Q5. Does the combinator_description setter (and create_entity's
          player_description) truncate at 500 bytes like import does, where in
          a multi-byte character, and do leading / trailing newlines, CRLF,
          whitespace-only and empty values survive setter -> capture -> export?
      Q6. Other paths: capturing the ghosts before revive (do ghosts keep
          tags?), rebuilding the recaptured blueprint elsewhere, LuaEntity.clone,
          LuaSurface.clone_area, copy_settings, rotate, and recapturing into a
          blueprint stack that already has a label and description (does the
          "select new contents" path keep them, so a hash could live there?).

    The method is the usual one: throwaway mod, isolated config, headless
    `--create`, dump JSON, `error()` out. Every text crosses into Lua as hex or
    as a base64 blueprint string and comes back as hex or as an export string,
    which is decoded in **Node** with zlib, so neither the game's JSON writer
    nor Lua escaping is in the comparison path.

    Controls:

      - **Instrument**: Q1's import must report code 0 and the export must
        contain every chunk of every case; a case that does not is reported as
        an import failure, never as "chunk lost".
      - **Instrument**: every capture must contain N combinators; a capture with
        fewer is flagged (an entity that did not get built is not a
        "description lost").
      - **Voiding**: an error anywhere in a scenario is recorded with the
        scenario and its findings are left out of the summary.

    Usage:
        node tools/oracle/probe-code-in-combinators.mjs                  # summary
        node tools/oracle/probe-code-in-combinators.mjs --write-fixture  # recapture
        node tools/oracle/probe-code-in-combinators.mjs --raw-out /tmp/cic.json

    FACTORIO_BIN and the data-directory resolution are as in
    probe-text-limits.mjs (on Linux bin/x64/factorio is a wrapper that execs
    bin/x64_/factorio, so data/ is looked up at both depths and written into
    config.ini as an absolute path).
*/
import { deflateSync, inflateSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { TextDecoder } from 'node:util'

const BIN =
    process.env.FACTORIO_BIN ??
    (process.platform === 'linux'
        ? `${process.env.HOME}/.var/app/com.valvesoftware.Steam/.local/share/Steam/steamapps/common/Factorio/bin/x64/factorio`
        : `${process.env.HOME}/Library/Application Support/Steam/steamapps/common/Factorio/factorio.app/Contents/MacOS/factorio`)

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(HERE, 'fixtures', 'code-in-combinators.json')
const WRITE_FIXTURE = process.argv.includes('--write-fixture')
const flag = name => {
    const i = process.argv.indexOf(name)
    return i === -1 ? undefined : process.argv[i + 1]
}
const RAW_OUT = flag('--raw-out')

const MOD = 'bp_code_in_combinators'
const DUMP = 'code-in-combinators-dump.json'

const versionOut = spawnSync(BIN, ['--version'], { encoding: 'utf8' }).stdout ?? ''
const binaryLine = versionOut.split('\n')[0].trim()
const binaryVersion = (binaryLine.match(/(\d+)\.(\d+)\.(\d+)/) ?? []).slice(1).map(Number)
if (binaryVersion.length !== 3) {
    console.error(`Could not read a version out of ${BIN}: ${JSON.stringify(binaryLine)}`)
    process.exit(1)
}
const MOD_FACTORIO_VERSION = `${binaryVersion[0]}.${binaryVersion[1]}`
const version = (a, b, c, d = 0) => a * 2 ** 48 + b * 2 ** 32 + c * 2 ** 16 + d
const BP_VERSION = version(...binaryVersion)

const DATA_DIR = [join(dirname(BIN), '..', 'data'), join(dirname(BIN), '..', '..', 'data')]
    .map(p => resolve(p))
    .find(p => existsSync(join(p, 'core')))
if (!DATA_DIR) {
    console.error(`No data/core next to ${BIN}`)
    process.exit(1)
}

/* ------------------------------------------------------------------ helpers */

const encodeJson = json => `0${deflateSync(Buffer.from(json, 'utf8')).toString('base64')}`
const decodeString = s => inflateSync(Buffer.from(s.slice(1), 'base64')).toString('utf8')
const hex = s => Buffer.from(s, 'utf8').toString('hex')
const unhex = h => Buffer.from(h, 'hex').toString('utf8')
const bytes = s => Buffer.byteLength(s, 'utf8')
const sha256 = s => createHash('sha256').update(s, 'utf8').digest('hex')
const arr = x => (Array.isArray(x) ? x : x && typeof x === 'object' ? Object.values(x) : [])

/* deterministic shuffle so the fixture is reproducible */
const rng = seed => () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
const shuffle = (a, seed) => {
    const r = rng(seed)
    const b = [...a]
    for (let i = b.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1))
        ;[b[i], b[j]] = [b[j], b[i]]
    }
    return b
}

/* --------------------------------------------------------------- the program */

const LONG_LINE =
    "const banner = '" +
    'Fabrik-Übersicht 🏭 – Grüße an alle Ingenieure! '.repeat(12) +
    "' // a single line longer than 500 bytes, it has to be split mid-line"
const PROGRAM_LINES = [
    '// PrOBE user script – baut eine Fabrik 🏭',
    "'use strict'",
    '',
    'const CONFIG = {',
    "\tname: 'Grünes Schaltkreis-Modul',",
    "\temoji: '🚂🛤️',",
    '\tpath: "C:\\\\factorio\\\\script-output\\\\probe.json",',
    '\tregex: /^[a-zäöüß]+\\d*$/iu,',
    '\tquote: "He said \\"Größe\\" and left",',
    "\tsingle: 'it\\'s fine',",
    '}',
    '',
    LONG_LINE,
    '',
    '/**',
    ' * Lays out a row of assemblers with inserters on both sides.',
    ' * Umlaute: Ärger, Öl, Übel – ß bleibt ß.',
    ' */',
    'export function layoutRow(bp, count, recipe) {',
    '\tfor (let i = 0; i < count; i++) {',
    '\t\tconst x = i * 3 // three tiles per assembler',
    "\t\tbp.add('assembling-machine-2', { x, y: 0 }, { recipe })",
    "\t\tbp.add('inserter', { x, y: -2 }, { direction: 'south' })",
    "\t\tbp.add('inserter', { x, y: 2 }, { direction: 'south' })",
    '\t}',
    '\treturn bp',
    '}',
    '',
    '// Windows line endings below this comment\r',
    'export const crlfBlock = [\r',
    "\t'eins',\r",
    "\t'zwei',\r",
    "\t'drei',\r",
    ']\r',
    '',
    'const table = `',
    '| Spalte | Wert |',
    '|--------|------|',
    '| Länge  | 42   |',
    '| Zeichen| "\\t" |',
    '`',
    '',
    'function escapeAll(s) {',
    "\treturn s.replace(/\\\\/g, '\\\\\\\\').replace(/\"/g, '\\\\\"').replace(/\\n/g, '\\\\n')",
    '}',
    '',
    'export async function main(api) {',
    "\tconst bp = api.newBlueprint('Fließband 🚀')",
    '\tlayoutRow(bp, 8, CONFIG.name)',
    '\tif (bp.entities.length > 0 && !api.dryRun) {',
    '\t\tapi.log(`Gebaut: ${bp.entities.length} Entitäten – ${CONFIG.emoji}`)',
    '\t}',
    "\tconst sum = bp.entities.reduce((a, e) => a + (e.name === 'inserter' ? 1 : 0), 0)",
    "\tapi.log('Greifarme: ' + sum + ' \\u00fc ' + escapeAll(CONFIG.quote))",
    '\treturn bp',
    '}',
    '',
]
/* pad with more realistic code until there are at least 12 chunks */
for (let k = 0; PROGRAM_LINES.length < 400; k++) {
    PROGRAM_LINES.push(
        `export function helper${k}(bp, x = ${k}, y = ${k * 2}) {`,
        `\t// Hilfsfunktion Nr. ${k} – prüft Größe & Position 📐`,
        `\tif (x < 0 || y < 0) throw new Error("Ungültige Position: \\"" + x + ',' + y + '\\"')`,
        `\treturn bp.add('constant-combinator', { x, y }, { description: 'Kombinator ${k} – ü\\tö' })`,
        '}',
        ''
    )
}
const FULL_PROGRAM = PROGRAM_LINES.join('\n')

const MAX = 500
/* split at line boundaries; a line over MAX is split at a code-point boundary */
const chunkCode = code => {
    const lines = code.match(/[^\n]*\n|[^\n]+$/g) ?? []
    const out = []
    let cur = ''
    for (let line of lines) {
        while (bytes(line) > MAX) {
            if (cur) {
                out.push(cur)
                cur = ''
            }
            let take = ''
            for (const ch of line) {
                if (bytes(take + ch) > MAX) break
                take += ch
            }
            out.push(take)
            line = line.slice(take.length)
        }
        if (bytes(cur + line) > MAX) {
            out.push(cur)
            cur = ''
        }
        cur += line
    }
    if (cur) out.push(cur)
    return out
}
const ALL_CHUNKS = chunkCode(FULL_PROGRAM)
const programFor = n => {
    const chunks =
        n === 1 ? chunkCode(PROGRAM_LINES.slice(0, 12).join('\n') + '\n') : ALL_CHUNKS.slice(0, n)
    const code = chunks.join('')
    if (chunkCode(code).join('\u0000') !== chunks.join('\u0000'))
        throw new Error(`chunking of N=${n} is not stable`)
    return { code, chunks, hash: sha256(code) }
}
const PROGRAMS = Object.fromEntries([1, 3, 12].map(n => [n, programFor(n)]))
for (const n of [1, 3, 12])
    if (PROGRAMS[n].chunks.length !== n)
        throw new Error(`N=${n} program has ${PROGRAMS[n].chunks.length} chunks`)

/* ---------------------------------------------------------------- layouts */

const layoutPositions = (n, layout) => {
    const cols = layout === 'row' ? n : Math.ceil(Math.sqrt(n))
    return Array.from({ length: n }, (_, i) => ({
        x: (i % cols) + 0.5,
        y: Math.floor(i / cols) + 0.5,
    }))
}

const icons = [{ index: 1, signal: { name: 'constant-combinator' } }]
const codeEntities = (n, layout, numbering, seed = 7) => {
    const { chunks, code, hash } = PROGRAMS[n]
    const pos = layoutPositions(n, layout)
    const perm =
        numbering === 'shuffled' ? shuffle([...Array(n).keys()], seed) : [...Array(n).keys()]
    const ents = chunks.map((c, i) => ({
        entity_number: numbering === 'gapped' ? (n - i) * 10 : perm[i] + 1,
        name: 'constant-combinator',
        position: pos[i],
        player_description: c,
        ...(i === 0 ? { tags: { probe_code: code, probe_hash: hash } } : {}),
    }))
    /* array order is shuffled too for the non-ordered variants */
    return numbering === 'ordered' ? ents : shuffle(ents, seed + 1)
}
const bookFor = entities => ({
    blueprint_book: {
        item: 'blueprint-book',
        label: 'PrOBE',
        blueprints: [
            {
                index: 0,
                blueprint: {
                    item: 'blueprint',
                    label: 'main',
                    icons: [{ index: 1, signal: { name: 'wooden-chest' } }],
                    entities: [
                        { entity_number: 1, name: 'wooden-chest', position: { x: 0.5, y: 0.5 } },
                    ],
                    version: BP_VERSION,
                },
            },
            {
                index: 1,
                blueprint: {
                    item: 'blueprint',
                    label: '#code',
                    description: 'PrOBE code',
                    icons,
                    entities,
                    version: BP_VERSION,
                },
            },
        ],
        active_index: 0,
        version: BP_VERSION,
    },
})

/* ----------------------------------------------------------------- scenarios */

const IMPORTS = []
for (const n of [1, 3, 12])
    for (const layout of ['row', 'grid'])
        for (const numbering of ['ordered', 'shuffled', 'gapped']) {
            const ents = codeEntities(n, layout, numbering)
            IMPORTS.push({
                id: `N${n}-${layout}-${numbering}`,
                n,
                layout,
                numbering,
                ents,
                str: encodeJson(JSON.stringify(bookFor(ents))),
            })
        }

const DIRS = { north: 0, east: 4, south: 8, west: 12 }
const editedChunk = (n, k) => {
    const c = PROGRAMS[n].chunks[k]
    const lines = c.split('\n')
    const li = lines.findIndex(l => l.length > 3)
    lines[li] = lines[li] + ' // im Spiel geändert ✎'
    return lines.join('\n')
}
const BUILDS = []
for (const n of [1, 3, 12])
    for (const layout of ['row', 'grid']) {
        const b = {
            id: `Q2-build-N${n}-${layout}`,
            q: 'Q2',
            n,
            layout,
            dir: 0,
            dx: 0,
            dy: 0,
            str: encodeJson(JSON.stringify(bookFor(codeEntities(n, layout, 'ordered')))),
        }
        if (n === 12) {
            const k = 4
            b.edit = { k, old: hex(PROGRAMS[n].chunks[k]), new: hex(editedChunk(n, k)) }
            const k2 = 9
            b.editOver = {
                k: k2,
                old: hex(PROGRAMS[n].chunks[k2]),
                new: hex(PROGRAMS[n].chunks[k2] + 'x'.repeat(MAX)),
            }
            b.extras = true
        }
        BUILDS.push(b)
    }
for (const layout of ['row', 'grid'])
    for (const [dname, dir] of Object.entries(DIRS))
        BUILDS.push({
            id: `Q3-build-N12-${layout}-${dname}-offset`,
            q: 'Q3',
            n: 12,
            layout,
            dir,
            dx: 3.3,
            dy: -7.7,
            capMargin: { l: 1, t: 5, r: 9, b: 2 },
            str: encodeJson(JSON.stringify(bookFor(codeEntities(12, layout, 'ordered')))),
        })

const CREATES = []
for (const n of [1, 3, 12])
    for (const layout of ['row', 'grid']) {
        const pos = layoutPositions(n, layout)
        CREATES.push({
            id: `Q2-create-N${n}-${layout}-shuffled-creation`,
            q: 'Q2',
            n,
            layout,
            ents: PROGRAMS[n].chunks.map((c, i) => ({ x: pos[i].x, y: pos[i].y, desc: hex(c) })),
            order: shuffle([...Array(n).keys()], 99).map(i => i + 1),
            dir: 0,
            mirror: false,
        })
    }
/* simulated flips: what building a flipped blueprint would leave in the world */
for (const layout of ['row', 'grid'])
    for (const flip of ['horizontal', 'vertical']) {
        const pos = layoutPositions(12, layout)
        CREATES.push({
            id: `Q3-create-N12-${layout}-flip-${flip}-simulated`,
            q: 'Q3',
            n: 12,
            layout,
            flip,
            ents: PROGRAMS[12].chunks.map((c, i) => ({
                x: flip === 'horizontal' ? -pos[i].x : pos[i].x,
                y: flip === 'vertical' ? -pos[i].y : pos[i].y,
                desc: hex(c),
            })),
            order: [...Array(12).keys()].map(i => i + 1),
            dir: flip === 'vertical' ? 8 : 0,
            mirror: true,
        })
    }

const SETTER_CASES = {
    ascii_500: 'a'.repeat(500),
    ascii_501: 'a'.repeat(501),
    ascii_600: 'b'.repeat(600),
    e_acute_straddles_500: 'a'.repeat(499) + 'é' + 'zz',
    emoji_straddles_500: 'a'.repeat(498) + '🚂' + 'zz',
    leading_newlines: '\n\nconst a = 1',
    trailing_newline: 'const a = 1\n',
    trailing_newlines: 'const a = 1\n\n\n',
    crlf_edges: '\r\nconst a = 1\r\n',
    only_newline: '\n',
    whitespace_only: ' \t \n ',
    leading_trailing_spaces: '  x  ',
    empty: '',
    tabs_quotes_backslashes: '\tconst s = "a\\"b" + \'c\' + `\\\\`\n',
    lone_cr: 'a\rb',
    chunk_with_newline_at_500: 'c'.repeat(499) + '\n',
}
const SETTERS = Object.entries(SETTER_CASES).map(([id, s]) => ({ id, s: hex(s) }))

/* ------------------------------------------------------------------- mod */

const lua = v => {
    if (v === null || v === undefined) return 'nil'
    if (typeof v === 'boolean' || typeof v === 'number') return String(v)
    if (typeof v === 'string') {
        if (/[\]=]/.test(v) && v.includes(']==]')) throw new Error('lua string clash')
        return `[==[${v}]==]`
    }
    if (Array.isArray(v)) return `{${v.map(lua).join(', ')}}`
    return `{${Object.entries(v)
        .map(([k, x]) => `[${JSON.stringify(k)}] = ${lua(x)}`)
        .join(', ')}}`
}

const control = `
local DUMP = ${JSON.stringify(DUMP)}
local IMPORTS = ${lua(IMPORTS.map(({ id, str }) => ({ id, str })))}
local BUILDS = ${lua(BUILDS.map(({ id, dir, dx, dy, capMargin, str, edit, editOver, extras }) => ({ id, dir, dx, dy, capMargin, str, edit, editOver, extras })))}
local CREATES = ${lua(CREATES.map(({ id, ents, order, dir, mirror }) => ({ id, ents, order, dir, mirror })))}
local SETTERS = ${lua(SETTERS)}

local function hex(s)
  if type(s) ~= "string" then return nil end
  return (s:gsub(".", function(c) return string.format("%02x", c:byte()) end))
end
local function unhex(h) return (h:gsub("..", function(x) return string.char(tonumber(x, 16)) end)) end

local S, F
local regionN = 0
local function region()
  local i = regionN; regionN = regionN + 1
  local ox = -200 + (i % 10) * 40
  local oy = -200 + math.floor(i / 10) * 40
  local area = {{ox, oy}, {ox + 40, oy + 40}}
  for _, e in pairs(S.find_entities_filtered{area = area}) do
    if e.valid and e.type ~= "character" then e.destroy() end
  end
  local tiles = {}
  for x = ox, ox + 39 do for y = oy, oy + 39 do tiles[#tiles + 1] = {name = "lab-dark-1", position = {x, y}} end end
  S.set_tiles(tiles)
  return {x = ox + 20, y = oy + 20}, area
end

local function newStack(name)
  local inv = game.create_inventory(1)
  inv[1].set_stack{name = name or "blueprint"}
  return inv[1]
end

local function capture(area, stack)
  stack = stack or newStack()
  local ok, map = pcall(function() return stack.create_blueprint{surface = S, force = F, area = area} end)
  local r = {area = area}
  if not ok then r.err = tostring(map) return r end
  if not stack.is_blueprint_setup() then r.empty = true return r end
  r.export = stack.export_stack()
  r.map = {}
  for k, e in pairs(map) do
    local u = e.valid and (e.unit_number or (e.type == "entity-ghost" and e.ghost_unit_number)) or nil
    r.map[#r.map + 1] = {n = k, unit = u, x = e.position.x, y = e.position.y, type = e.type}
  end
  return r, stack
end

local function readEnt(e)
  local d = {unit = e.unit_number, x = e.position.x, y = e.position.y, dir = e.direction, type = e.type}
  local ok, v = pcall(function() return e.combinator_description end)
  d.desc = ok and hex(v) or ("ERR:" .. tostring(v))
  local okm, m = pcall(function() return e.mirroring end)
  if okm then d.mirroring = m else d.mirroring = "ERR:" .. tostring(m) end
  if e.type == "entity-ghost" then
    d.ghostUnit = e.ghost_unit_number
    local okt, t = pcall(function() return e.tags end)
    if okt and t then
      d.tags = {}
      for k, x in pairs(t) do d.tags[k] = type(x) == "string" and hex(x) or tostring(x) end
    end
  end
  return d
end
local function readAll(ents)
  local out = {}
  for i, e in ipairs(ents) do out[i] = e.valid and readEnt(e) or {invalid = true} end
  return out
end

local function findCode(book)
  local bi = book.get_inventory(defines.inventory.item_main)
  for i = 1, #bi do
    local s = bi[i]
    if s.valid_for_read and s.is_blueprint and s.label == "#code" then return s end
  end
end

local function importBook(str)
  local st = newStack()
  local code = st.import_stack(str)
  return st, code
end

local function bbox(ents, m)
  local x1, y1, x2, y2 = math.huge, math.huge, -math.huge, -math.huge
  for _, e in ipairs(ents) do
    if e.valid then
      local p = e.position
      x1 = math.min(x1, p.x); y1 = math.min(y1, p.y); x2 = math.max(x2, p.x); y2 = math.max(y2, p.y)
    end
  end
  return {{x1 - m.l, y1 - m.t}, {x2 + m.r, y2 + m.b}}
end

local function findByDesc(ents, s)
  for _, e in ipairs(ents) do if e.valid and e.combinator_description == s then return e end end
end

local function buildCase(c, out)
  local center, area = region()
  local book, code = importBook(c.str)
  out.importCode = code
  local bp = findCode(book)
  if not bp then out.err = "no #code blueprint in book" return end
  local pos = {x = center.x + c.dx, y = center.y + c.dy}
  out.buildPosition = pos
  local ghosts = bp.build_blueprint{surface = S, force = F, position = pos, build_mode = defines.build_mode.forced, direction = c.dir}
  out.ghostCount = #ghosts
  out.ghosts = readAll(ghosts)
  if c.extras then out.ghostCapture = capture(area) end
  local ents = {}
  for _, g in ipairs(ghosts) do
    if g.valid then
      local ok, _, e = pcall(function() return g.revive() end)
      if ok and e then ents[#ents + 1] = e end
    end
  end
  out.revived = readAll(ents)
  out.capture = capture(area)
  if c.capMargin then out.captureTight = capture(bbox(ents, c.capMargin)) end
  if c.extras then
    local x = {}
    -- recapture into a stack that already has label + description (the "select new contents" path)
    local labelled = newStack()
    labelled.import_stack(out.capture.export)
    labelled.label = "#code"
    labelled.blueprint_description = "probe_hash:abc"
    local _, st = capture(area, labelled)
    x.relabelledLabel = st and st.label
    x.relabelledDescription = st and st.blueprint_description
    x.relabelledExport = st and st.is_blueprint_setup() and st.export_stack() or nil
    -- rebuild the recaptured blueprint elsewhere
    do
      local c2, a2 = region()
      local st2 = newStack(); st2.import_stack(out.capture.export)
      local gh = st2.build_blueprint{surface = S, force = F, position = c2, build_mode = defines.build_mode.forced}
      for _, g in ipairs(gh) do if g.valid then g.revive() end end
      x.rebuild = capture(a2)
    end
    -- LuaEntity.clone
    do
      local c3, a3 = region()
      for _, e in ipairs(ents) do
        if e.valid then e.clone{position = {c3.x + (e.position.x - center.x), c3.y + (e.position.y - center.y)}} end
      end
      x.clone = capture(a3)
    end
    -- LuaSurface.clone_area
    do
      local _, a4 = region()
      local ok, err = pcall(function()
        S.clone_area{source_area = area, destination_area = a4, destination_surface = S, clone_tiles = false}
      end)
      x.cloneAreaErr = (not ok) and tostring(err) or nil
      x.cloneArea = capture(a4)
    end
    -- copy_settings onto a fresh combinator, and rotate
    do
      local c5 = region()
      local dst = S.create_entity{name = "constant-combinator", position = {c5.x + 0.5, c5.y + 0.5}, force = F}
      local ok, err = pcall(function() dst.copy_settings(ents[1]) end)
      x.copySettingsErr = (not ok) and tostring(err) or nil
      x.copySettingsDesc = hex(dst.combinator_description)
      x.copySettingsSource = hex(ents[1].combinator_description)
      local okr, rr = pcall(function() return ents[2] and ents[2].rotate() end)
      x.rotateOk = okr and rr or tostring(rr)
      x.rotatedDesc = ents[2] and hex(ents[2].combinator_description)
      x.rotatedDir = ents[2] and ents[2].direction
    end
    out.extras = x
  end
  if c.edit then
    local e = findByDesc(ents, unhex(c.edit.old))
    if e then
      e.combinator_description = unhex(c.edit.new)
      out.editReadback = hex(e.combinator_description)
      out.captureAfterEdit = capture(area)
    else out.editErr = "chunk not found" end
  end
  if c.editOver then
    local e = findByDesc(ents, unhex(c.editOver.old))
    if e then
      e.combinator_description = unhex(c.editOver.new)
      out.editOverReadback = hex(e.combinator_description)
      out.captureAfterEditOver = capture(area)
    else out.editOverErr = "chunk not found" end
  end
end

local function createCase(c, out)
  local center, area = region()
  local ents = {}
  for _, idx in ipairs(c.order) do
    local s = c.ents[idx]
    local ok, e = pcall(function()
      return S.create_entity{name = "constant-combinator", position = {center.x + s.x, center.y + s.y}, force = F,
        direction = c.dir, mirror = c.mirror, player_description = unhex(s.desc)}
    end)
    if not ok then out.err = tostring(e) return end
    ents[#ents + 1] = e
  end
  out.created = readAll(ents)
  out.capture = capture(area)
  out.captureTight = capture(bbox(ents, {l = 3, t = 1, r = 0.5, b = 6}))
end

local function setterCase(c, out)
  local center, area = region()
  local s = unhex(c.s)
  local e = S.create_entity{name = "constant-combinator", position = {center.x + 0.5, center.y + 0.5}, force = F}
  local ok, err = pcall(function() e.combinator_description = s end)
  out.setErr = (not ok) and tostring(err) or nil
  out.readback = hex(e.combinator_description)
  out.capture = capture(area)
  if out.capture.export then
    local st = newStack()
    out.reimportCode = st.import_stack(out.capture.export)
    out.reexport = st.export_stack()
  end
  local e2
  local ok2, err2 = pcall(function()
    e2 = S.create_entity{name = "constant-combinator", position = {center.x + 5.5, center.y + 0.5}, force = F, player_description = s}
  end)
  out.createErr = (not ok2) and tostring(err2) or nil
  out.createReadback = e2 and hex(e2.combinator_description)
end

script.on_init(function()
  local out = {mods = script.active_mods, imports = {}, builds = {}, creates = {}, setters = {}}
  S = game.surfaces[1]; F = game.forces.player
  S.always_day = true
  S.request_to_generate_chunks({0, -100}, 8); S.force_generate_chunk_requests()

  for i, c in ipairs(IMPORTS) do
    local r = {id = c.id}
    local ok, err = pcall(function()
      local st, code = importBook(c.str)
      r.code = code
      r.export = st.export_stack()
      local st2 = newStack()
      r.code2 = st2.import_stack(r.export)
      r.export2 = st2.export_stack()
    end)
    if not ok then r.err = tostring(err) end
    out.imports[i] = r
  end
  for i, c in ipairs(BUILDS) do
    local r = {id = c.id}
    local ok, err = pcall(buildCase, c, r)
    if not ok then r.err = tostring(err) end
    out.builds[i] = r
  end
  for i, c in ipairs(CREATES) do
    local r = {id = c.id}
    local ok, err = pcall(createCase, c, r)
    if not ok then r.err = tostring(err) end
    out.creates[i] = r
  end
  for i, c in ipairs(SETTERS) do
    local r = {id = c.id}
    local ok, err = pcall(setterCase, c, r)
    if not ok then r.err = tostring(err) end
    out.setters[i] = r
  end

  helpers.write_file(DUMP, helpers.table_to_json(out))
  error("DUMPED-OK")
end)
`

const work = flag('--work') ?? mkdtempSync(join(tmpdir(), 'fbe-code-in-combinators-'))
const writeData = join(work, 'write-data')
const modDir = join(work, 'mods')
const modPath = join(modDir, `${MOD}_0.0.1`)
mkdirSync(writeData, { recursive: true })
mkdirSync(modPath, { recursive: true })
writeFileSync(
    join(modPath, 'info.json'),
    JSON.stringify({
        name: MOD,
        version: '0.0.1',
        title: 'Can code live in combinator descriptions',
        author: 'oracle',
        factorio_version: MOD_FACTORIO_VERSION,
        dependencies: ['base'],
    })
)
writeFileSync(join(modPath, 'control.lua'), control)
writeFileSync(
    join(work, 'config.ini'),
    `[path]\nread-data=${DATA_DIR}\nwrite-data=${writeData}\n[general]\n[other]\n`
)

const started = Date.now()
const res = spawnSync(
    BIN,
    [
        '--create',
        join(work, 'p.zip'),
        '--mod-directory',
        modDir,
        '--config',
        join(work, 'config.ini'),
    ],
    {
        encoding: 'utf8',
        maxBuffer: 1 << 30,
    }
)
const dumpPath = join(writeData, 'script-output', DUMP)
if (!existsSync(dumpPath)) {
    console.error('No dump. tail:\n' + ((res.stdout ?? '') + (res.stderr ?? '')).slice(-4000))
    process.exit(1)
}
const raw = JSON.parse(readFileSync(dumpPath, 'utf8'))
const seconds = (Date.now() - started) / 1000

/* ---------------------------------------------------------------- analysis */

const bpOf = (exportStr, label) => {
    const t = JSON.parse(decodeString(exportStr))
    if (t.blueprint) return t.blueprint
    return t.blueprint_book.blueprints.find(b => b.blueprint?.label === label)?.blueprint
}
const ccs = bp => (bp?.entities ?? []).filter(e => e.name === 'constant-combinator')
const chunkIndex = (chunks, d) => chunks.indexOf(d)

/* rotate a vector by -dir (dir in 16ths, multiples of 4); y points down */
const unrotate = ({ x, y }, dir) => {
    let p = { x, y }
    for (let k = 0; k < ((dir ?? 0) / 4) % 4; k++) p = { x: p.y, y: -p.x }
    return p
}
const sortYX = list => [...list].sort((a, b) => a.p.y - b.p.y || a.p.x - b.p.x)

/* Everything we want to know about one capture of N combinators. */
const analyseCapture = (cap, n, { expectedRel, flip } = {}) => {
    if (!cap) return { missing: true }
    if (cap.err || cap.empty) return { err: cap.err ?? 'empty' }
    const { chunks, code, hash } = PROGRAMS[n]
    const bp = bpOf(cap.export)
    const es = ccs(bp)
    const r = { combinators: es.length, complete: es.length === n }
    const idx = es.map(e => chunkIndex(chunks, e.player_description ?? ''))
    r.descriptionsExact = idx.filter(i => i >= 0).length === n && new Set(idx).size === n
    r.missingDescriptions = es.filter(e => e.player_description === undefined).length
    r.tagsPresent = es.some(e => e.tags)
    r.directions = [...new Set(es.map(e => e.direction ?? 0))]
    r.mirror = [...new Set(es.map(e => e.mirror ?? false))]
    const byNumber = [...es].sort((a, b) => a.entity_number - b.entity_number)
    r.entityNumbers = byNumber.map(e => e.entity_number)
    r.arrayOrderIsEntityNumberOrder = es.every(
        (e, i) => e.entity_number === byNumber[i].entity_number
    )
    r.chunkOrderByEntityNumber = byNumber.map(e => chunkIndex(chunks, e.player_description ?? ''))
    r.entityNumberFollowsChunkOrder = r.chunkOrderByEntityNumber.every((c, i) => c === i)
    /* creation order: create_blueprint's map gives entity_number -> unit_number */
    const units = Object.fromEntries(arr(cap.map).map(m => [m.n, m.unit]))
    const unitSeq = byNumber.map(e => units[e.entity_number])
    r.entityNumberFollowsUnitNumber = unitSeq.every((u, i) => i === 0 || u > unitSeq[i - 1])
    const posOrder = sortYX(byNumber.map(e => ({ n: e.entity_number, p: e.position })))
    r.entityNumberFollowsPositionYX = posOrder.every((x, i) => x.n === byNumber[i].entity_number)
    const posOrderXY = [...byNumber].sort(
        (a, b) => a.position.x - b.position.x || a.position.y - b.position.y
    )
    r.entityNumberFollowsPositionXY = posOrderXY.every(
        (x, i) => x.entity_number === byNumber[i].entity_number
    )
    r.positionsByEntityNumber = byNumber.map(e => [e.position.x, e.position.y])
    /* recovery: undo the rotation (all combinators share one direction; source was north) */
    const dir = r.directions.length === 1 ? r.directions[0] : 0
    const plain = sortYX(es.map(e => ({ d: e.player_description ?? '', p: e.position })))
    r.recoveredBySortYXRaw = plain.map(x => x.d).join('') === code
    const un = sortYX(
        es.map(e => ({ d: e.player_description ?? '', p: unrotate(e.position, dir) }))
    )
    r.recoveredBySortYXAfterUnrotate = sha256(un.map(x => x.d).join('')) === hash
    if (flip) {
        /* a mirrored row: undo the flip on the axis, then sort */
        const f = sortYX(
            es.map(e => {
                const q = unrotate(e.position, dir)
                return {
                    d: e.player_description ?? '',
                    p: flip === 'horizontal' || flip === 'vertical' ? { x: -q.x, y: q.y } : q,
                }
            })
        )
        r.recoveredAfterUnrotateAndUnmirror = sha256(f.map(x => x.d).join('')) === hash
    }
    if (expectedRel && r.descriptionsExact) {
        const byChunk = []
        es.forEach(e => (byChunk[chunkIndex(chunks, e.player_description)] = e.position))
        const o = byChunk[0]
        r.relativePositionsPreserved = expectedRel.every(
            (q, i) =>
                Math.abs(byChunk[i].x - o.x - q.x) < 1e-9 &&
                Math.abs(byChunk[i].y - o.y - q.y) < 1e-9
        )
        if (!r.relativePositionsPreserved)
            r.relativePositions = byChunk.map(p => [p.x - o.x, p.y - o.y])
    }
    r.concatHashMatches = sha256(byNumber.map(e => e.player_description ?? '').join('')) === hash
    return r
}
const relFor = (n, layout, dir = 0) => {
    const p = layoutPositions(n, layout)
    const rot = q => {
        let v = { x: q.x - p[0].x, y: q.y - p[0].y }
        for (let k = 0; k < dir / 4; k++) v = { x: -v.y, y: v.x }
        return v
    }
    return p.map(rot)
}

/* Q1 */
const q1 = IMPORTS.map((c, i) => {
    const r = arr(raw.imports)[i] ?? {}
    const { chunks, code, hash } = PROGRAMS[c.n]
    const o = { id: c.id, importCode: r.code ?? null }
    if (r.err || !r.export) return { ...o, err: r.err ?? 'no export' }
    const bp = bpOf(r.export, '#code')
    const es = ccs(bp)
    o.combinators = es.length
    o.chunksExact = chunks.every(ch => es.filter(e => e.player_description === ch).length === 1)
    const tagged = es.filter(e => e.tags)
    o.tagsExact =
        tagged.length === 1 &&
        tagged[0].tags.probe_code === code &&
        tagged[0].tags.probe_hash === hash
    const inNumbers = c.ents.map(e => e.entity_number)
    const inByChunk = Object.fromEntries(
        c.ents.map(e => [chunkIndex(chunks, e.player_description), e])
    )
    o.importArrayChunkOrder = c.ents.map(e => chunkIndex(chunks, e.player_description))
    o.importEntityNumbers = inNumbers
    o.exportArrayChunkOrder = es.map(e => chunkIndex(chunks, e.player_description))
    o.exportEntityNumbers = es.map(e => e.entity_number)
    o.entityNumbersKeptPerChunk = es.every(
        e => inByChunk[chunkIndex(chunks, e.player_description)]?.entity_number === e.entity_number
    )
    o.exportArraySortedByEntityNumber = es.every(
        (e, k) => k === 0 || e.entity_number > es[k - 1].entity_number
    )
    o.exportArrayOrderSameAsImport =
        o.exportArrayChunkOrder.join() === o.importArrayChunkOrder.join()
    o.positionsKeptPerChunk = es.every(e => {
        const s = inByChunk[chunkIndex(chunks, e.player_description)]
        return s && s.position.x === e.position.x && s.position.y === e.position.y
    })
    if (!o.positionsKeptPerChunk)
        o.exportPositions = es.map(e => [
            chunkIndex(chunks, e.player_description),
            e.position.x,
            e.position.y,
        ])
    o.bookLabelKept = JSON.parse(decodeString(r.export)).blueprint_book?.label === 'PrOBE'
    o.codeBlueprintDescription = bp?.description
    o.reimportCode = r.code2
    o.exportIsFixedPoint = r.export2 === r.export
    return o
})

/* Q2 / Q3 / Q4 / Q6 */
const builds = BUILDS.map((c, i) => {
    const r = arr(raw.builds)[i] ?? {}
    const o = {
        id: c.id,
        n: c.n,
        layout: c.layout,
        direction: c.dir,
        buildPositionOffset: [c.dx, c.dy],
    }
    if (r.err) o.err = r.err
    o.importCode = r.importCode
    o.ghostCount = r.ghostCount
    const { chunks, code, hash } = PROGRAMS[c.n]
    const ghosts = arr(r.ghosts)
    o.ghostsKeepDescriptions =
        ghosts.length === c.n && ghosts.every(g => chunks.includes(unhex(g.desc ?? '')))
    const taggedGhosts = ghosts.filter(g => g.tags)
    o.ghostTags = taggedGhosts.length
        ? {
              count: taggedGhosts.length,
              codeExact: unhex(taggedGhosts[0].tags.probe_code ?? '') === code,
              hashExact: unhex(taggedGhosts[0].tags.probe_hash ?? '') === hash,
          }
        : 'none'
    o.ghostCreationOrderIsBlueprintOrder = ghosts.every(
        (g, k) => chunks.indexOf(unhex(g.desc ?? '')) === k
    )
    const rev = arr(r.revived)
    o.revivedDescriptionsExact =
        rev.length === c.n && rev.every(e => chunks.includes(unhex(e.desc ?? '')))
    o.revivedPositions = rev.map(e => [e.x, e.y])
    o.capture = analyseCapture(r.capture, c.n, { expectedRel: relFor(c.n, c.layout, c.dir) })
    if (r.captureTight)
        o.captureTightOrigin = analyseCapture(r.captureTight, c.n, {
            expectedRel: relFor(c.n, c.layout, c.dir),
        })
    if (r.ghostCapture) o.ghostCapture = analyseCapture(r.ghostCapture, c.n, {})
    if (c.edit) {
        const after = bpOf(r.captureAfterEdit?.export ?? '0' + deflateSync('{}').toString('base64'))
        const ds = ccs(after).map(e => e.player_description ?? '')
        const newText = unhex(c.edit.new)
        const orig = new Set(chunks)
        o.edit = {
            editedChunkIndex: c.edit.k,
            newBytes: bytes(newText),
            readbackExact: unhex(r.editReadback ?? '') === newText,
            captureContainsNewTextExactly: ds.includes(newText),
            unchangedChunksStillExact: chunks
                .filter((_, k) => k !== c.edit.k)
                .every(ch => ds.includes(ch)),
            changedDescriptions: ds.filter(d => !orig.has(d)).length,
            hashOfRecaptureByPosition: (() => {
                const es = sortYX(
                    ccs(after).map(e => ({ d: e.player_description ?? '', p: e.position }))
                )
                const h = sha256(es.map(x => x.d).join(''))
                return {
                    differsFromStoredHash: h !== hash,
                    equalsHashOfEditedProgram:
                        h ===
                        sha256(chunks.map((ch, k) => (k === c.edit.k ? newText : ch)).join('')),
                }
            })(),
        }
    }
    if (c.editOver) {
        const want = unhex(c.editOver.new)
        const got = unhex(r.editOverReadback ?? '')
        const after = r.captureAfterEditOver?.export ? ccs(bpOf(r.captureAfterEditOver.export)) : []
        const editedText = c.edit ? unhex(c.edit.new) : undefined
        const inCap = after
            .map(e => e.player_description ?? '')
            .find(d => !chunks.includes(d) && d !== editedText)
        o.editOverLimit = {
            attemptedBytes: bytes(want),
            readbackBytes: bytes(got),
            readbackIsPrefix: want.startsWith(got),
            captureBytes: inCap === undefined ? null : bytes(inCap),
            captureEqualsReadback: inCap === got,
        }
    }
    if (r.extras) {
        const x = r.extras
        o.extras = {
            recaptureIntoLabelledStack: {
                labelKept: x.relabelledLabel === '#code',
                descriptionKept: x.relabelledDescription === 'probe_hash:abc',
                label: x.relabelledLabel,
                description: x.relabelledDescription,
                contents: x.relabelledExport
                    ? analyseCapture({ export: x.relabelledExport, map: r.capture?.map }, c.n, {})
                    : null,
            },
            rebuildRecapturedElsewhere: analyseCapture(x.rebuild, c.n, {
                expectedRel: relFor(c.n, c.layout),
            }),
            luaEntityClone: analyseCapture(x.clone, c.n, { expectedRel: relFor(c.n, c.layout) }),
            surfaceCloneArea: {
                err: x.cloneAreaErr,
                ...analyseCapture(x.cloneArea, c.n, { expectedRel: relFor(c.n, c.layout) }),
            },
            copySettings: {
                err: x.copySettingsErr,
                descriptionCopied: x.copySettingsDesc === x.copySettingsSource,
                copiedBytes: x.copySettingsDesc ? Buffer.from(x.copySettingsDesc, 'hex').length : 0,
            },
            rotate: {
                ok: x.rotateOk,
                newDirection: x.rotatedDir,
                descriptionKept: chunks.includes(unhex(x.rotatedDesc ?? '')),
            },
        }
    }
    return o
})

const creates = CREATES.map((c, i) => {
    const r = arr(raw.creates)[i] ?? {}
    const o = {
        id: c.id,
        n: c.n,
        layout: c.layout,
        creationOrder: c.order,
        mirrorRequested: c.mirror,
        flip: c.flip,
    }
    if (r.err) return { ...o, err: r.err }
    const cr = arr(r.created)
    o.createdDescriptionsExact = cr.every(
        (e, k) => unhex(e.desc ?? '') === unhex(c.ents[c.order[k] - 1].desc)
    )
    o.createdMirroring = [...new Set(cr.map(e => e.mirroring))]
    const rel = c.ents.map(e => ({ x: e.x - c.ents[0].x, y: e.y - c.ents[0].y }))
    o.capture = analyseCapture(r.capture, c.n, { expectedRel: rel, flip: c.flip })
    o.captureTightOrigin = analyseCapture(r.captureTight, c.n, { expectedRel: rel, flip: c.flip })
    return o
})

/* the setter cuts bytes, not characters: compare raw bytes, and say whether the
   game's own export is still valid UTF-8 */
const utf8Valid = buf => {
    try {
        new TextDecoder('utf-8', { fatal: true }).decode(buf)
        return true
    } catch {
        return false
    }
}
const setters = SETTERS.map((c, i) => {
    const r = arr(raw.setters)[i] ?? {}
    const want = unhex(c.s)
    const got = unhex(r.readback ?? '')
    const o = { id: c.id, bytesIn: bytes(want), setErr: r.setErr }
    const rawIn = Buffer.from(c.s, 'hex')
    const rawGot = Buffer.from(r.readback ?? '', 'hex')
    o.readbackRawBytes = rawGot.length
    o.readbackIsRawBytePrefix = rawIn.subarray(0, rawGot.length).equals(rawGot)
    o.readbackValidUtf8 = utf8Valid(rawGot)
    if (r.capture?.export)
        o.exportJsonValidUtf8 = utf8Valid(
            inflateSync(Buffer.from(r.capture.export.slice(1), 'base64'))
        )
    o.createEntityParamRawBytes = Buffer.from(r.createReadback ?? '', 'hex').length
    o.readbackBytes = bytes(got)
    o.readbackExact = got === want
    o.readbackIsPrefix = want.startsWith(got)
    if (!o.readbackExact) o.readbackTailHex = hex(got.slice(-4))
    const es = r.capture?.export ? ccs(bpOf(r.capture.export)) : []
    const inCap = es[0]?.player_description
    o.captureHasKey = es[0] ? 'player_description' in es[0] : null
    o.captureExact = (inCap ?? '') === want
    o.captureEqualsReadback = (inCap ?? '') === got
    if (!o.captureExact) o.captureHex = inCap === undefined ? null : hex(inCap)
    const re = r.reexport ? ccs(bpOf(r.reexport))[0]?.player_description : undefined
    o.reimportCode = r.reimportCode
    o.reimportExportEqualsCapture = re === inCap
    const cg = unhex(r.createReadback ?? '')
    o.createEntityParamReadbackExact = cg === want
    o.createEntityParamReadbackBytes = bytes(cg)
    o.createErr = r.createErr
    return o
})

const errors = [...arr(raw.imports), ...arr(raw.builds), ...arr(raw.creates), ...arr(raw.setters)]
    .filter(r => r.err)
    .map(r => ({ id: r.id, err: r.err }))

const result = {
    question:
        'Can PrOBE keep user JS as 500-byte chunks in constant-combinator player_descriptions (plus full code + hash in tags on the first one) in a "#code" blueprint, so that it survives import/export, building into the world, in-game editing and recapture?',
    provenance: {
        binary: binaryLine,
        modFactorioVersion: MOD_FACTORIO_VERSION,
        blueprintVersionStamp: binaryVersion.join('.'),
        mods: raw.mods,
        capturedBy: 'tools/oracle/probe-code-in-combinators.mjs',
        capturedOn: new Date().toISOString().slice(0, 10),
        method: 'headless --create; book strings built in Node; import_stack/export_stack; build_blueprint(forced)+revive or create_entity(player_description); create_blueprint; edits via LuaEntity.combinator_description; all exports decoded in Node with zlib.',
        runSeconds: seconds,
    },
    program: {
        bytesByN: Object.fromEntries(Object.entries(PROGRAMS).map(([n, p]) => [n, bytes(p.code)])),
        chunkBytesByN: Object.fromEntries(
            Object.entries(PROGRAMS).map(([n, p]) => [n, p.chunks.map(bytes)])
        ),
        hasCRLF: PROGRAMS[12].code.includes('\r\n'),
        hasTabs: PROGRAMS[12].code.includes('\t'),
        hasEmoji: /\p{Extended_Pictographic}/u.test(PROGRAMS[12].code),
        hasUmlauts: /[äöüÄÖÜß]/.test(PROGRAMS[12].code),
        hasLineOver500Bytes: PROGRAMS[12].code.split('\n').some(l => bytes(l) > 500),
        chunksStartingWithNewline: PROGRAMS[12].chunks.filter(
            c => c.startsWith('\n') || c.startsWith('\r')
        ).length,
        chunksEndingWithNewline: PROGRAMS[12].chunks.filter(c => c.endsWith('\n')).length,
        hashN12: PROGRAMS[12].hash,
    },
    errors,
    q1ImportExport: q1,
    q2q3q4q6Builds: builds,
    q2q3Creates: creates,
    q5Setter: setters,
}

if (RAW_OUT) writeFileSync(RAW_OUT, JSON.stringify({ result, raw }, null, 2) + '\n')
if (WRITE_FIXTURE) {
    writeFileSync(FIXTURE, JSON.stringify(result, null, 4) + '\n')
    console.log(`wrote ${FIXTURE}`)
}
console.log(JSON.stringify(result, null, 2))
