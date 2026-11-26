/*
    Where can PrOBE keep a user's JavaScript inside a blueprint book so that it
    survives the game? Not "where is there a text field" - every candidate has
    one - but which field comes back byte-for-byte after the game has imported
    the string and exported it again, how long it may be, and what the game does
    to the text when it is too long.

    The method is the usual one (throwaway mod, isolated config, headless
    `--create`, dump JSON, `error()` out), applied as a pure round trip:
    `LuaItemStack.import_stack` a string, `export_stack` it straight back, decode
    the export and compare the field with what went in.

    Carriers, each measured the same way:

      - blueprint `description` and `label`
      - blueprint_book `description` and `label`
      - the `description` of a blueprint nested inside a book
      - `player_description` on constant / decider / arithmetic combinators
        (2.0's "comment" field - the key is confirmed by stage 1, not assumed)
      - display-panel `text`, train-stop `station`
      - an entity's `tags` table, which has no UI but is what mods use

    Three stages, all in one run:

      1. **Key discovery.** Build the entities on a surface, set their text
         through the runtime API (`combinator_description`,
         `display_panel_text`, `backer_name`, `label`, `blueprint_description`),
         `create_blueprint` and export. The JSON keys the game writes are the
         ones the later stages use; if a key here disagrees with a template
         below, the template is wrong, not the game.
      2. **Size ladder + bisection**, in Lua so a 10 MB string never has to
         travel through control.lua. Each carrier gets a template blueprint
         (built here, in Node, the way the editor would build it) with a
         placeholder; Lua splices in an alphanumeric text of n bytes - no JSON
         escaping needed - encodes, round-trips and compares. The ladder stops at
         the first n that does not come back exactly, and the gap is bisected
         to the byte. If a limit exists, the same search is repeated with
         2-byte (`é`) and 4-byte (emoji) characters, which is what answers
         "bytes, code points or UTF-16 units".
      3. **Character fidelity.** Newlines (LF, CRLF, lone CR), tabs, quotes,
         backslashes, control characters, NUL, BOM, U+2028, non-ASCII, astral
         emoji, ZWJ sequences, leading/trailing whitespace, empty strings, rich
         text tags and a realistic JS snippet. Each case is encoded in Node -
         once with raw UTF-8, once with every non-ASCII character `\u`-escaped
         (surrogate pairs for astral) - and the game's export is decoded in
         **Node**, with zlib, not in Lua, so the comparison does not go through
         the game's own JSON reader on the way out. The export is also
         re-imported and re-exported to check it is a fixed point.

    Controls:

      - **Instrument**: a 1-byte text must come back exact on every carrier.
        If it does not, the carrier's template is broken and its "limit" is 0
        for the wrong reason.
      - **Instrument**: the over-limit sample must be classified. An outcome of
        "absent" with import code 0 and "import-failed" with code -1 are
        different findings; both are recorded, never collapsed to "failed".
      - **Voiding**: if stage 1 cannot find the entities it built, the run says
        so - a missing key would otherwise read as "the game drops this field".

    Usage:
        node tools/oracle/probe-text-limits.mjs                  # print summary
        node tools/oracle/probe-text-limits.mjs --write-fixture  # recapture
        node tools/oracle/probe-text-limits.mjs --raw-out /tmp/text-limits-raw.json

    FACTORIO_BIN defaults to the Linux Steam-via-Flatpak path on Linux and the
    macOS Steam path elsewhere. On Linux `bin/x64/factorio` is a bash wrapper
    that execs `bin/x64_/factorio`, so `__PATH__executable__/../data` points at
    `bin/data`, which does not exist; the data directory is therefore resolved
    here and written into config.ini as an absolute path.
*/
import { deflateSync, inflateSync } from 'node:zlib'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const BIN =
    process.env.FACTORIO_BIN ??
    (process.platform === 'linux'
        ? `${process.env.HOME}/.var/app/com.valvesoftware.Steam/.local/share/Steam/steamapps/common/Factorio/bin/x64/factorio`
        : `${process.env.HOME}/Library/Application Support/Steam/steamapps/common/Factorio/factorio.app/Contents/MacOS/factorio`)

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(HERE, 'fixtures', 'text-limits.json')
const WRITE_FIXTURE = process.argv.includes('--write-fixture')
const flag = name => {
    const i = process.argv.indexOf(name)
    return i === -1 ? undefined : process.argv[i + 1]
}
const RAW_OUT = flag('--raw-out')

const MOD = 'bp_text_limits'
const DUMP = 'text-limits-dump.json'

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

/* bin/x64/factorio (Linux wrapper) -> bin/x64_/factorio, so try both depths. */
const DATA_DIR = [join(dirname(BIN), '..', 'data'), join(dirname(BIN), '..', '..', 'data')]
    .map(p => resolve(p))
    .find(p => existsSync(join(p, 'core')))
if (!DATA_DIR) {
    console.error(`No data/core next to ${BIN}`)
    process.exit(1)
}

/* ------------------------------------------------------------------ carriers */

const PH = '@@TEXT@@'
const icons = [{ index: 1, signal: { name: 'constant-combinator' } }]
const cc = { entity_number: 1, name: 'constant-combinator', position: { x: 0.5, y: 0.5 } }
const bp = (over = {}, entities = [cc]) => ({
    blueprint: { item: 'blueprint', label: 'probe', icons, entities, version: BP_VERSION, ...over },
})
const book = (over = {}, inner = {}) => ({
    blueprint_book: {
        item: 'blueprint-book',
        label: 'probe book',
        blueprints: [{ index: 0, ...bp(inner) }],
        active_index: 0,
        version: BP_VERSION,
        ...over,
    },
})
const ent = (name, position, field) => bp({}, [{ entity_number: 1, name, position, ...field }])

/* path elements: string key, number (0-based array index), or {name} to find an entity */
const CARRIERS = [
    {
        id: 'blueprint.description',
        tpl: bp({ description: PH }),
        path: ['blueprint', 'description'],
    },
    { id: 'blueprint.label', tpl: bp({ label: PH }), path: ['blueprint', 'label'] },
    {
        id: 'blueprint_book.description',
        tpl: book({ description: PH }),
        path: ['blueprint_book', 'description'],
    },
    { id: 'blueprint_book.label', tpl: book({ label: PH }), path: ['blueprint_book', 'label'] },
    {
        id: 'blueprint_book.blueprints[0].blueprint.description',
        tpl: book({}, { description: PH }),
        path: ['blueprint_book', 'blueprints', 0, 'blueprint', 'description'],
    },
    {
        id: 'constant-combinator.player_description',
        tpl: ent('constant-combinator', { x: 0.5, y: 0.5 }, { player_description: PH }),
        path: ['blueprint', 'entities', { name: 'constant-combinator' }, 'player_description'],
    },
    {
        id: 'decider-combinator.player_description',
        tpl: ent('decider-combinator', { x: 0.5, y: 1 }, { player_description: PH }),
        path: ['blueprint', 'entities', { name: 'decider-combinator' }, 'player_description'],
    },
    {
        id: 'arithmetic-combinator.player_description',
        tpl: ent('arithmetic-combinator', { x: 0.5, y: 1 }, { player_description: PH }),
        path: ['blueprint', 'entities', { name: 'arithmetic-combinator' }, 'player_description'],
    },
    {
        id: 'display-panel.text',
        tpl: ent('display-panel', { x: 0.5, y: 0.5 }, { text: PH }),
        path: ['blueprint', 'entities', { name: 'display-panel' }, 'text'],
    },
    {
        id: 'train-stop.station',
        tpl: ent('train-stop', { x: 1, y: 1 }, { direction: 0, station: PH }),
        path: ['blueprint', 'entities', { name: 'train-stop' }, 'station'],
    },
    {
        id: 'constant-combinator.tags.code',
        tpl: ent('constant-combinator', { x: 0.5, y: 0.5 }, { tags: { code: PH } }),
        path: ['blueprint', 'entities', { name: 'constant-combinator' }, 'tags', 'code'],
    },
]

const substitute = (node, text) => {
    if (node === PH) return text
    if (Array.isArray(node)) return node.map(n => substitute(n, text))
    if (node && typeof node === 'object')
        return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, substitute(v, text)]))
    return node
}
const getPath = (t, path) => {
    for (const k of path) {
        if (t == null || typeof t !== 'object') return undefined
        t =
            typeof k === 'object'
                ? Array.isArray(t)
                    ? t.find(e => e?.name === k.name)
                    : undefined
                : t[k]
    }
    return t
}
const asciiEscape = json =>
    json.replace(/[\u007f-\uffff]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
const encodeJson = json => `0${deflateSync(Buffer.from(json, 'utf8')).toString('base64')}`
const decodeString = s => inflateSync(Buffer.from(s.slice(1), 'base64')).toString('utf8')

/* ------------------------------------------------------------ charset cases */

const JS_SNIPPET = [
    '// PrOBE user script',
    "const name = 'Basic builder' // single",
    'const msg = "double \\"quoted\\" \\\\ backslash"',
    'const re = /a\\/b\\d+/g',
    'const tpl = `template ${name}\\n`',
    'if (a < b && c > d || !e) { x = 1 }',
    '\tindented with tab',
    "export default { 'ä': '中文', emoji: '🚂' }",
    '',
].join('\n')

const CASES = {
    lf: 'line1\nline2\n\nline4',
    crlf: 'line1\r\nline2\r\n',
    cr: 'line1\rline2',
    tab: 'a\tb\t\tc',
    quotes: `double " single ' back \` end`,
    backslashes: 'C:\\path\\n not-a-newline \\\\ \\u0041 \\',
    json_like: '{"a":[1,2,{"b":"c"}]}',
    controls: 'a\u0001b\u001fc\u007fd\u0008e\u000cf',
    nul: 'a\u0000b',
    bom: '\ufeffstarts with BOM',
    u2028: 'a\u2028b\u2029c',
    latin1: 'äöü ß é ñ Ω €',
    cjk: '中文テキスト한국어',
    emoji: '😀🚂🏭',
    zwj: '👨‍👩‍👧 flag 🇩🇪 skin 👍🏽',
    combining: 'e\u0301 vs é',
    lone_surrogate_escape: null /* JSON-only: an unpaired \ud800 */,
    whitespace_edges: '  leading and trailing  \n',
    only_space: ' ',
    empty: '',
    rich_text:
        '[item=iron-plate] [color=red]red[/color] [font=default-bold]b[/font] [img=item/iron-plate]',
    js_snippet: JS_SNIPPET,
}

/* ------------------------------------------------------------------- mod */

const luaPath = path =>
    '{' +
    path
        .map(k =>
            typeof k === 'object'
                ? `{name = ${JSON.stringify(k.name)}}`
                : typeof k === 'number'
                  ? String(k + 1)
                  : JSON.stringify(k)
        )
        .join(', ') +
    '}'

const luaCarriers = CARRIERS.map(
    c =>
        `  {id = ${JSON.stringify(c.id)}, tpl = [==[${JSON.stringify(c.tpl)}]==], path = ${luaPath(c.path)}},`
).join('\n')

const charsetCases = []
for (const c of CARRIERS) {
    for (const [name, text] of Object.entries(CASES)) {
        for (const enc of ['utf8', 'ascii-escaped']) {
            let json
            if (text === null) {
                if (enc !== 'ascii-escaped') continue
                json = JSON.stringify(substitute(c.tpl, PH)).replace(PH, 'x\\ud800y')
            } else {
                json = JSON.stringify(substitute(c.tpl, text))
                if (enc === 'ascii-escaped') json = asciiEscape(json)
            }
            charsetCases.push({ carrier: c.id, case: name, enc, text, str: encodeJson(json) })
        }
    }
}
const luaCharset = charsetCases.map((k, i) => `  [${i + 1}] = [==[${k.str}]==],`).join('\n')

const LADDER = [1, 100, 500, 1000, 5000, 10000, 65535, 65536, 100000, 1000000, 10000000]
/* Unlimited carriers go further, to look for a whole-string ceiling. */
const BIG = [33554432, 67108864, 134217728]

const control = `
local DUMP = ${JSON.stringify(DUMP)}
local CARRIERS = {
${luaCarriers}
}
local CHARSET = {
${luaCharset}
}
local LADDER = {${LADDER.join(', ')}}
local BIG = {${BIG.join(', ')}}

local function get(t, path)
  for _, k in ipairs(path) do
    if type(t) ~= "table" then return nil end
    if type(k) == "table" then
      local found
      for _, e in ipairs(t) do if type(e) == "table" and e.name == k.name then found = e break end end
      t = found
    else
      t = t[k]
    end
  end
  return t
end

local function utf8len(s)
  local n = 0
  for i = 1, #s do
    local b = s:byte(i)
    if b < 0x80 or b >= 0xC0 then n = n + 1 end
  end
  return n
end

local inv -- game is nil at load time; created on first use inside on_init

local function roundtrip(str)
  inv = inv or game.create_inventory(1)
  inv[1].clear()
  inv[1].set_stack{name = "blueprint"}
  local ok, code = pcall(function() return inv[1].import_stack(str) end)
  local r = {}
  if not ok then r.err = tostring(code) return r end
  r.code = code
  if not inv[1].valid_for_read then r.empty = true return r end
  r.item = inv[1].name
  local ok2, exp = pcall(function() return inv[1].export_stack() end)
  if not ok2 or type(exp) ~= "string" or exp == "" then r.export_err = tostring(exp) return r end
  r.export = exp
  local ok3, js = pcall(function() return helpers.decode_string(exp:sub(2)) end)
  if ok3 and js then
    local ok4, t = pcall(function() return helpers.json_to_table(js) end)
    if ok4 then r.t = t end
  end
  return r
end

local function fill(tpl, text)
  local i, j = tpl:find("${PH}", 1, true)
  return tpl:sub(1, i - 1) .. text .. tpl:sub(j + 1)
end

-- Incompressible-ish alphanumeric block. Deflate's window is 32 KiB, so a
-- 64 KiB block repeated still costs ~6 bits a byte and the string grows with n.
local ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
-- Park-Miller: 16807 * 2^31 < 2^53, so it is exact in a double.
local seed = 12345
local parts = {}
for i = 1, 65536 do
  seed = (seed * 16807) % 2147483647
  local k = seed % #ALNUM + 1
  parts[i] = ALNUM:sub(k, k)
end
local BLOCK = table.concat(parts)

local GEN = {
  ascii = function(n) return string.rep(BLOCK, math.ceil(n / #BLOCK)):sub(1, n) end,
  e_acute = function(n) return string.rep("\\195\\169", n) end,        -- U+00E9, 2 bytes
  emoji = function(n) return string.rep("\\240\\159\\154\\130", n) end, -- U+1F682, 4 bytes, 2 UTF-16 units
}

local function check(c, text)
  local s
  local okb, berr = pcall(function() s = "0" .. helpers.encode_string(fill(c.tpl, text)) end)
  if not okb then return {inBytes = #text, outcome = "encode-error", err = tostring(berr)} end
  local r = roundtrip(s)
  local res = {inBytes = #text, inChars = utf8len(text), stringLength = #s, code = r.code, err = r.err,
               export_err = r.export_err, exportLength = r.export and #r.export, item = r.item}
  local got = r.t and get(r.t, c.path)
  if r.err then res.outcome = "import-error"
  elseif got == nil then res.outcome = (r.code == -1) and "import-failed" or "absent"
  elseif type(got) ~= "string" then res.outcome = "wrong-type:" .. type(got)
  elseif got == text then res.outcome = "exact"
  elseif text:sub(1, #got) == got then
    res.outcome = "truncated-prefix"; res.outBytes = #got; res.outChars = utf8len(got)
  else
    res.outcome = "altered"; res.outBytes = #got; res.outChars = utf8len(got)
  end
  return res
end

local function search(c, gen, ladder)
  local steps, lo, hi = {}, 0, nil
  for _, n in ipairs(ladder) do
    local res = check(c, gen(n)); res.n = n
    steps[#steps + 1] = res
    if res.outcome == "exact" then lo = n else hi = n break end
  end
  local result = {ladder = steps, maxExact = lo}
  if hi then
    local probes = 0
    while hi - lo > 1 do
      local mid = math.floor((lo + hi) / 2)
      probes = probes + 1
      if check(c, gen(mid)).outcome == "exact" then lo = mid else hi = mid end
    end
    result.maxExact = lo
    result.firstInexact = hi
    result.bisectProbes = probes
    local over = check(c, gen(hi)); over.n = hi
    result.atFirstInexact = over
    local far = check(c, gen(hi * 2)); far.n = hi * 2
    result.atDouble = far
  end
  return result
end

script.on_init(function()
  local out = {mods = script.active_mods, discovery = {}, limits = {}, charset = {}}

  -- stage 1: what keys does the game itself write?
  do
    local s = game.surfaces[1]; local f = game.forces.player
    s.request_to_generate_chunks({0, 0}, 3); s.force_generate_chunk_requests()
    local tiles = {}
    for x = -40, 40 do for y = -40, 40 do tiles[#tiles + 1] = {name = "grass-1", position = {x, y}} end end
    s.set_tiles(tiles)
    for _, e in pairs(s.find_entities_filtered{area = {{-40, -40}, {40, 40}}}) do
      if e.valid and e.type ~= "character" then e.destroy() end
    end
    local d = out.discovery
    local function try(name, fn) local ok, e = pcall(fn); d[name] = ok and "ok" or tostring(e) end
    local ccE = s.create_entity{name = "constant-combinator", position = {0.5, 0.5}, force = f}
    local dcE = s.create_entity{name = "decider-combinator", position = {3, 0.5}, force = f}
    local acE = s.create_entity{name = "arithmetic-combinator", position = {6, 0.5}, force = f}
    local dpE = s.create_entity{name = "display-panel", position = {9.5, 0.5}, force = f}
    for x = -10, 20, 2 do s.create_entity{name = "straight-rail", position = {x + 1, 11}, direction = defines.direction.east, force = f} end
    local tsE = s.create_entity{name = "train-stop", position = {5, 9}, direction = defines.direction.east, force = f}
    try("constant-combinator.combinator_description", function() ccE.combinator_description = "CC-DESC" end)
    try("decider-combinator.combinator_description", function() dcE.combinator_description = "DC-DESC" end)
    try("arithmetic-combinator.combinator_description", function() acE.combinator_description = "AC-DESC" end)
    try("display-panel.display_panel_text", function() dpE.display_panel_text = "DP-TEXT" end)
    try("train-stop.backer_name", function() tsE.backer_name = "TS-NAME" end)
    local dinv = game.create_inventory(1)
    dinv[1].set_stack{name = "blueprint"}
    dinv[1].create_blueprint{surface = s, force = f, area = {{-12, -5}, {22, 14}}, include_station_names = true}
    try("blueprint.label", function() dinv[1].label = "BP-LABEL" end)
    try("blueprint.blueprint_description", function() dinv[1].blueprint_description = "BP-DESC" end)
    -- does the runtime API apply the same cap the import does?
    local long = string.rep("x", 5000)
    local api = {}
    local function apiLen(name, set, get)
      local ok, e = pcall(set)
      if not ok then api[name] = tostring(e) return end
      local ok2, v = pcall(get)
      api[name] = ok2 and (type(v) == "string" and #v or tostring(v)) or tostring(v)
    end
    local ainv = game.create_inventory(1)
    ainv[1].set_stack{name = "blueprint"}
    ainv[1].set_blueprint_entities{{entity_number = 1, name = "constant-combinator", position = {0.5, 0.5}}}
    apiLen("LuaItemStack.label", function() ainv[1].label = long end, function() return ainv[1].label end)
    apiLen("LuaItemStack.blueprint_description", function() ainv[1].blueprint_description = long end, function() return ainv[1].blueprint_description end)
    apiLen("LuaEntity.combinator_description", function() ccE.combinator_description = long end, function() return ccE.combinator_description end)
    apiLen("LuaEntity.display_panel_text", function() dpE.display_panel_text = long end, function() return dpE.display_panel_text end)
    apiLen("LuaEntity.backer_name", function() tsE.backer_name = long end, function() return tsE.backer_name end)
    d.apiSetterReadbackBytesFor5000 = api
    ccE.combinator_description = "CC-DESC"; dpE.display_panel_text = "DP-TEXT"; tsE.backer_name = "TS-NAME"
    dinv[1].clear(); dinv[1].set_stack{name = "blueprint"}
    dinv[1].create_blueprint{surface = s, force = f, area = {{-12, -5}, {22, 14}}, include_station_names = true}
    dinv[1].label = "BP-LABEL"; dinv[1].blueprint_description = "BP-DESC"
    local exp = dinv[1].export_stack()
    local t = helpers.json_to_table(helpers.decode_string(exp:sub(2)))
    d.exportPrefix = exp:sub(1, 1)
    d.blueprintKeys = {}
    for k, v in pairs(t.blueprint) do if type(v) ~= "table" then d.blueprintKeys[k] = v end end
    d.entities = {}
    for _, e in ipairs(t.blueprint.entities or {}) do
      if e.name ~= "straight-rail" then
        local keys = {}
        for k, v in pairs(e) do if type(v) == "string" and k ~= "name" then keys[k] = v end end
        d.entities[e.name] = keys
      end
    end
    -- the same through a book, to see what nesting writes
    local binv = game.create_inventory(1)
    binv[1].set_stack{name = "blueprint-book"}
    local bi = binv[1].get_inventory(defines.inventory.item_main)
    bi.insert(dinv[1])
    try("blueprint-book.label", function() binv[1].label = "BOOK-LABEL" end)
    try("blueprint-book.blueprint_description", function() binv[1].blueprint_description = "BOOK-DESC" end)
    local bexp = binv[1].export_stack()
    local bt = helpers.json_to_table(helpers.decode_string(bexp:sub(2)))
    d.bookKeys = {}
    for k, v in pairs(bt.blueprint_book or {}) do if type(v) ~= "table" then d.bookKeys[k] = v end end
    d.bookFirstIndex = bt.blueprint_book and bt.blueprint_book.blueprints and bt.blueprint_book.blueprints[1] and bt.blueprint_book.blueprints[1].index
  end

  -- stage 2: sizes
  for ci, c in ipairs(CARRIERS) do
    local L = {}
    local ladder = LADDER
    L.ascii = search(c, GEN.ascii, ladder)
    if not L.ascii.firstInexact then
      -- no limit up to the ladder's top: keep climbing to find a string ceiling
      local big = {}
      for _, n in ipairs(BIG) do
        local ok, r = pcall(check, c, GEN.ascii(n))
        if not ok then r = {outcome = "lua-error", err = tostring(r)} end
        r.n = n
        big[#big + 1] = r
        if r.outcome ~= "exact" then break end
      end
      L.big = big
    end
    if L.ascii.firstInexact then
      local lim = L.ascii.maxExact
      -- an odd byte count of 2-byte chars: the limit falls mid-character
      local odd = check(c, "a" .. GEN.e_acute(math.ceil(lim / 2)))
      odd.note = "'a' followed by e-acute so the byte limit falls inside a character"
      L.midCharacter = odd
      -- same search in characters, to tell bytes from code points from UTF-16
      L.e_acute = search(c, GEN.e_acute, LADDER)
      L.emoji = search(c, GEN.emoji, LADDER)
    else
      local probe = {}
      for _, name in ipairs({"e_acute", "emoji"}) do
        local r = check(c, GEN[name](1000000)); r.n = 1000000
        probe[name] = r
      end
      L.multibyteAt1e6 = probe
    end
    out.limits[c.id] = L
  end

  -- stage 3: character fidelity; the comparison happens in Node
  for i, str in ipairs(CHARSET) do
    local r = roundtrip(str)
    local e = {code = r.code, err = r.err, export_err = r.export_err, item = r.item, export = r.export}
    if r.export then
      local r2 = roundtrip(r.export)
      e.stable = (r2.export == r.export)
      if not e.stable then e.export2 = r2.export end
    end
    out.charset[i] = e
  end

  helpers.write_file(DUMP, helpers.table_to_json(out))
  error("DUMPED-OK")
end)
`

const work = flag('--work') ?? mkdtempSync(join(tmpdir(), 'fbe-text-limits-'))
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
        title: 'Which blueprint text fields round-trip, and how long',
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
    { encoding: 'utf8', maxBuffer: 1 << 30 }
)
const dumpPath = join(writeData, 'script-output', DUMP)
if (!existsSync(dumpPath)) {
    console.error('No dump. tail:\n' + ((res.stdout ?? '') + (res.stderr ?? '')).slice(-4000))
    process.exit(1)
}
const raw = JSON.parse(readFileSync(dumpPath, 'utf8'))
const seconds = (Date.now() - started) / 1000

/* ---------------------------------------------------------------- analysis */

const hex = s => Buffer.from(s, 'utf8').toString('hex')
const charset = {}
charsetCases.forEach((k, i) => {
    /* table_to_json turns the Lua sequence into a 0-based JSON array */
    const r = (Array.isArray(raw.charset) ? raw.charset[i] : raw.charset[String(i + 1)]) ?? {}
    const carrier = CARRIERS.find(c => c.id === k.carrier)
    const entry = { importCode: r.code ?? null }
    if (r.err) entry.importError = r.err
    if (r.export) {
        const json = decodeString(r.export)
        const got = getPath(JSON.parse(json), carrier.path)
        entry.stable = r.stable
        if (r.stable === false && r.export2) {
            /* the string moved; say whether our field did, and where the rest differs */
            const json2 = decodeString(r.export2)
            entry.fieldStableOnReimport = getPath(JSON.parse(json2), carrier.path) === got
            let i = 0
            while (i < json.length && json[i] === json2[i]) i++
            entry.firstDifference = {
                first: json.slice(Math.max(0, i - 60), i + 60),
                second: json2.slice(Math.max(0, i - 60), i + 60),
            }
        }
        if (k.text === null) {
            entry.result = got === undefined ? 'absent' : 'kept'
            entry.outHex = got === undefined ? undefined : hex(got)
        } else if (got === undefined) entry.result = 'absent'
        else if (got === k.text) entry.result = 'exact'
        else {
            entry.result = 'changed'
            entry.inHex = hex(k.text)
            entry.outHex = hex(got)
        }
        if (k.carrier === 'blueprint.description' && k.enc === 'utf8') {
            const m = json.match(/"description":"((?:[^"\\]|\\.)*)"/)
            if (m) entry.exportedJsonFragment = m[1]
        }
    } else entry.result = r.export_err ? 'export-error' : 'no-export'
    ;((charset[k.carrier] ??= {})[k.case] ??= {})[k.enc] = entry
})

const summary = {}
for (const c of CARRIERS) {
    const L = raw.limits[c.id]
    const a = L.ascii
    const s = { maxExactAsciiBytes: a.maxExact, limited: Boolean(a.firstInexact) }
    if (a.firstInexact) {
        s.overLimit = a.atFirstInexact
        s.atDouble = a.atDouble
        s.maxExactEAcuteChars = L.e_acute.maxExact
        s.maxExactEmojiChars = L.emoji.maxExact
        s.midCharacter = L.midCharacter
        const ea = L.e_acute.maxExact
        const em = L.emoji.maxExact
        const lim = a.maxExact
        s.unit =
            Math.abs(ea * 2 - lim) <= 1 && Math.abs(em * 4 - lim) <= 3
                ? 'bytes (UTF-8)'
                : ea === lim && em === lim
                  ? 'code points'
                  : ea === lim && Math.abs(em * 2 - lim) <= 1
                    ? 'UTF-16 units'
                    : `unclear (ascii ${lim}, e-acute ${ea}, emoji ${em})`
    } else {
        s.beyondLadder = (L.big ?? []).map(r => ({
            n: r.n,
            outcome: r.outcome,
            importStringLength: r.stringLength,
            exportStringLength: r.exportLength,
            err: r.err,
        }))
        s.multibyteAt1e6 = Object.fromEntries(
            Object.entries(L.multibyteAt1e6).map(([k, v]) => [k, v.outcome])
        )
    }
    const cs = charset[c.id]
    s.charsetNotExact = []
    for (const [name, encs] of Object.entries(cs))
        for (const [enc, e] of Object.entries(encs))
            if (e.result !== 'exact' && !(name === 'lone_surrogate_escape'))
                s.charsetNotExact.push(
                    `${name}/${enc}: ${e.result}${e.outHex ? ` in=${e.inHex} out=${e.outHex}` : ''}`
                )
    const unstable = Object.values(cs).flatMap(encs =>
        Object.values(encs).filter(e => e.stable === false)
    )
    s.reimportUnstableCases = unstable.length
    if (unstable.length) {
        s.reimportFieldStillExact = unstable.every(e => e.fieldStableOnReimport)
        s.reimportFirstDifference = unstable[0].firstDifference
    }
    summary[c.id] = s
}

/* The biggest whole string that came back exact, on any carrier. */
let largest = null
for (const [id, L] of Object.entries(raw.limits))
    for (const r of [...L.ascii.ladder, ...(L.big ?? [])])
        if (r.outcome === 'exact' && r.stringLength > (largest?.importStringLength ?? 0))
            largest = {
                carrier: id,
                textBytes: r.n,
                importStringLength: r.stringLength,
                exportStringLength: r.exportLength,
            }

const result = {
    question:
        'Which text fields of a blueprint / blueprint book survive import_stack -> export_stack byte-for-byte, how long may they be, and what happens past the limit?',
    answer: Object.entries(summary)
        .map(([id, x]) =>
            x.limited
                ? `${id}: ${x.maxExactAsciiBytes} ${x.unit}, longer text is silently truncated (import code ${x.overLimit.code})`
                : `${id}: no limit up to ${Math.max(x.maxExactAsciiBytes, ...(x.beyondLadder ?? []).filter(b => b.outcome === 'exact').map(b => b.n))} bytes`
        )
        .join('; '),
    provenance: {
        binary: binaryLine,
        modFactorioVersion: MOD_FACTORIO_VERSION,
        blueprintVersionStamp: binaryVersion.join('.'),
        mods: raw.mods,
        capturedBy: 'tools/oracle/probe-text-limits.mjs',
        capturedOn: new Date().toISOString().slice(0, 10),
        method: 'headless --create; LuaItemStack.import_stack of Node-built strings, export_stack, compare. Sizes bisected in Lua with alphanumeric / U+00E9 / U+1F682 text; charset cases decoded in Node with zlib.',
        runSeconds: seconds,
    },
    discovery: raw.discovery,
    largestExactRoundTrip: largest,
    summary,
    limits: raw.limits,
    charsetCases: Object.fromEntries(
        Object.entries(CASES).map(([k, v]) => [k, v === null ? 'JSON "x\\ud800y"' : v])
    ),
    charset,
}

if (RAW_OUT) writeFileSync(RAW_OUT, JSON.stringify(result, null, 4) + '\n')
if (WRITE_FIXTURE) {
    writeFileSync(FIXTURE, JSON.stringify(result, null, 4) + '\n')
    console.log(`wrote ${FIXTURE}`)
}
console.log(
    JSON.stringify(
        {
            provenance: result.provenance,
            discovery: result.discovery,
            largestExactRoundTrip: result.largestExactRoundTrip,
            summary,
        },
        null,
        2
    )
)
