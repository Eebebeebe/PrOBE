/*
    How do electric poles connect when a blueprint is pasted?

    PrOBE's `paste(bp, x, y)` must connect power poles "like in Factorio" (user
    decision, docs/PLAN.md §9). The editor has a hand-placement heuristic
    (WireConnections.connectPowerPole: nearest poles in reach, at most 5), but
    nothing says what the game does with a *pasted* blueprint. So ask it:
    paste blueprints with `LuaItemStack.build_blueprint` - which places ghosts,
    as a player's paste does - then build every ghost with `revive()`, as a
    construction robot does, and read each pole's copper connections.

    Cases, each on its own patch of ground far from the others:
      A  one unwired pole, pasted 5 tiles from an existing pole
      B  two poles wired in the blueprint, the first 5 tiles from an existing one
      C  two unwired poles 5 tiles apart, nothing else around
      C2 the same, ghosts revived in the opposite order
      D  one unwired pole pasted 20 tiles from an existing pole (out of reach)
      E  one unwired pole pasted amid six existing poles, all in reach
      F  two poles wired in the blueprint but 12 tiles apart - beyond reach (9)
      H  one unwired pole pasted amid eight unconnected existing poles - is
         there a connection limit?
      I  a pole pasted 3 tiles from a pole that already holds five wires
      G  control: a pole made with LuaSurface.create_entity 5 tiles from one

    Medium electric poles throughout (reach 9). Existing poles are made with
    create_entity before anything is pasted; their own connections are read
    back too, since they are part of the answer.

    Usage:
        node tools/oracle/probe-pole-paste.mjs                  # print summary
        node tools/oracle/probe-pole-paste.mjs --write-fixture  # recapture
*/
import { deflateSync } from 'node:zlib'
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
const FIXTURE = join(HERE, 'fixtures', 'pole-paste.json')
const WRITE_FIXTURE = process.argv.includes('--write-fixture')

const MOD = 'bp_pole_paste'
const DUMP = 'pole-paste-dump.json'

const versionOut = spawnSync(BIN, ['--version'], { encoding: 'utf8' }).stdout ?? ''
const binaryLine = versionOut.split('\n')[0].trim()
const binaryVersion = (binaryLine.match(/(\d+)\.(\d+)\.(\d+)/) ?? []).slice(1).map(Number)
if (binaryVersion.length !== 3) {
    console.error(`Could not read a version out of ${BIN}: ${JSON.stringify(binaryLine)}`)
    process.exit(1)
}
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

/* ------------------------------------------------------------- blueprints */

const POLE = 'medium-electric-pole'
const COPPER = 5 // defines.wire_connector_id.pole_copper
const encode = obj => `0${deflateSync(Buffer.from(JSON.stringify(obj), 'utf8')).toString('base64')}`
const bp = (poles, wires = []) => ({
    poles,
    wires,
    string: encodeBp(poles, wires),
})
const encodeBp = (poles, wires) =>
    encode({
        blueprint: {
            item: 'blueprint',
            label: 'probe',
            icons: [{ index: 1, signal: { name: POLE } }],
            version: BP_VERSION,
            entities: poles.map(([x, y], i) => ({
                entity_number: i + 1,
                name: POLE,
                position: { x: x + 0.5, y: y + 0.5 },
            })),
            wires: wires.map(([a, b]) => [a, COPPER, b, COPPER]),
        },
    })

/*
    `existing` are tile offsets of poles placed before the paste; `paste` is the
    blueprint and where its first pole should land. Every case sits on its own
    origin, 200 tiles apart, so no two can see each other.
*/
const CASES = [
    { id: 'A', existing: [[0, 0]], bp: bp([[0, 0]]), at: [5, 0] },
    {
        id: 'B',
        existing: [[0, 0]],
        bp: bp(
            [
                [0, 0],
                [5, 0],
            ],
            [[1, 2]]
        ),
        at: [5, 0],
    },
    {
        id: 'C',
        existing: [],
        bp: bp([
            [0, 0],
            [5, 0],
        ]),
        at: [0, 0],
    },
    {
        id: 'C2',
        existing: [],
        bp: bp([
            [0, 0],
            [5, 0],
        ]),
        at: [0, 0],
        reverse: true,
    },
    { id: 'D', existing: [[0, 0]], bp: bp([[0, 0]]), at: [20, 0] },
    {
        id: 'E',
        existing: [
            [5, 0],
            [-5, 0],
            [0, 5],
            [0, -5],
            [4, 4],
            [-4, -4],
        ],
        bp: bp([[0, 0]]),
        at: [0, 0],
    },
    {
        id: 'F',
        existing: [],
        bp: bp(
            [
                [0, 0],
                [12, 0],
            ],
            [[1, 2]]
        ),
        at: [0, 0],
    },
    {
        // Eight poles around, every wire between them cut before the paste, so
        // nothing excludes anything and only a connection limit could stop it.
        id: 'H',
        existing: [
            [6, 0],
            [-6, 0],
            [0, 6],
            [0, -6],
            [4, 4],
            [-4, -4],
            [4, -4],
            [-4, 4],
        ],
        isolate: true,
        bp: bp([[0, 0]]),
        at: [0, 0],
    },
    {
        // A hub already holding five wires (to five spokes, nothing else), and a
        // pole pasted 3 tiles away: is the full hub skipped?
        id: 'I',
        existing: [
            [0, 0],
            [0, -8],
            [8, -2],
            [-8, -2],
            [5, 6],
            [-5, 6],
        ],
        isolate: true,
        star: true,
        bp: bp([[0, 0]]),
        at: [3, 0],
    },
    { id: 'G', existing: [[0, 0]], create: [5, 0] },
]

/* ----------------------------------------------------------------- the mod */

const work = mkdtempSync(join(tmpdir(), 'probe-oracle-'))
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
        title: 'How pasted poles connect',
        author: 'oracle',
        factorio_version: `${binaryVersion[0]}.${binaryVersion[1]}`,
        dependencies: ['base'],
    })
)

const luaCases = CASES.map(
    (c, i) => `{
      id = ${JSON.stringify(c.id)},
      origin = {${i * 200}, 0},
      existing = {${(c.existing ?? []).map(([x, y]) => `{${x}, ${y}}`).join(', ')}},
      bp = ${c.bp ? JSON.stringify(c.bp.string) : 'nil'},
      at = ${c.at ? `{${c.at[0]}, ${c.at[1]}}` : 'nil'},
      create = ${c.create ? `{${c.create[0]}, ${c.create[1]}}` : 'nil'},
      reverse = ${c.reverse ? 'true' : 'false'},
      isolate = ${c.isolate ? 'true' : 'false'},
      star = ${c.star ? 'true' : 'false'},
    }`
)

writeFileSync(
    join(modPath, 'control.lua'),
    `
local CASES = {
  ${luaCases.join(',\n  ')}
}

script.on_init(function()
  local surface = game.surfaces[1]
  local force = game.forces.player
  surface.always_day = true

  -- Flat, empty ground under every case.
  local span = #CASES * 200
  surface.request_to_generate_chunks({span / 2, 0}, math.ceil(span / 64) + 2)
  surface.force_generate_chunk_requests()
  for x = -40, span, 1 do
    local tiles = {}
    for y = -40, 40 do tiles[#tiles + 1] = {name = "grass-1", position = {x, y}} end
    surface.set_tiles(tiles)
  end
  for _, e in pairs(surface.find_entities_filtered{area = {{-40, -40}, {span, 40}}}) do
    if e.valid and e.type ~= "character" then e.destroy() end
  end
  force.chart_all()

  local inv = game.create_inventory(1)
  local out = {}

  local function copper(pole)
    local res = {}
    local ok, err = pcall(function()
      local conn = pole.get_wire_connector(defines.wire_connector_id.pole_copper, false)
      if conn then
        for _, c in pairs(conn.connections) do
          local p = c.target.owner.position
          res[#res + 1] = {p.x, p.y}
        end
      end
    end)
    if not ok then res = {error = tostring(err)} end
    return res
  end

  for _, c in ipairs(CASES) do
    local o = c.origin
    local r = {id = c.id, errors = {}, poles = {}}
    local function try(label, fn)
      local ok, err = pcall(fn)
      if not ok then r.errors[#r.errors + 1] = label .. ": " .. tostring(err) end
    end

    for _, p in ipairs(c.existing) do
      try("existing", function()
        surface.create_entity{name = "${POLE}", position = {o[1] + p[1] + 0.5, o[2] + p[2] + 0.5}, force = force}
      end)
    end

    if c.isolate then
      try("isolate", function()
        for _, e in pairs(surface.find_entities_filtered{area = {{o[1] - 40, o[2] - 40}, {o[1] + 40, o[2] + 40}}, type = "electric-pole"}) do
          e.get_wire_connector(defines.wire_connector_id.pole_copper, true).disconnect_all()
        end
      end)
    end

    if c.star then
      try("star", function()
        local hub = surface.find_entities_filtered{position = {o[1] + 0.5, o[2] + 0.5}, type = "electric-pole"}[1]
        local hc = hub.get_wire_connector(defines.wire_connector_id.pole_copper, true)
        for _, e in pairs(surface.find_entities_filtered{area = {{o[1] - 40, o[2] - 40}, {o[1] + 40, o[2] + 40}}, type = "electric-pole"}) do
          if e ~= hub then hc.connect_to(e.get_wire_connector(defines.wire_connector_id.pole_copper, true), false) end
        end
      end)
    end

    if c.bp then
      try("paste", function()
        inv[1].clear()
        inv[1].set_stack{name = "blueprint"}
        local code = inv[1].import_stack(c.bp)
        if code ~= 0 then error("import code " .. tostring(code)) end
        local ghosts = inv[1].build_blueprint{
          surface = surface,
          force = force,
          position = {o[1] + c.at[1] + 0.5, o[2] + c.at[2] + 0.5},
          build_mode = defines.build_mode.forced,
          skip_fog_of_war = false,
        }
        r.ghosts = #ghosts
        local order = {}
        for i = 1, #ghosts do order[i] = ghosts[i] end
        table.sort(order, function(a, b) return a.position.x < b.position.x end)
        if c.reverse then
          local rev = {}
          for i = #order, 1, -1 do rev[#rev + 1] = order[i] end
          order = rev
        end
        for _, g in ipairs(order) do
          if g.valid then g.revive() end
        end
      end)
    end

    if c.create then
      try("create", function()
        surface.create_entity{name = "${POLE}", position = {o[1] + c.create[1] + 0.5, o[2] + c.create[2] + 0.5}, force = force}
      end)
    end

    for _, e in pairs(surface.find_entities_filtered{area = {{o[1] - 40, o[2] - 40}, {o[1] + 40, o[2] + 40}}}) do
      if e.type == "electric-pole" or e.type == "entity-ghost" then
        local p = e.position
        local rel = {p.x - o[1], p.y - o[2]}
        local links = {}
        if e.type == "electric-pole" then
          for _, q in ipairs(copper(e)) do
            if type(q) == "table" and q[1] then links[#links + 1] = {q[1] - o[1], q[2] - o[2]} end
          end
        end
        r.poles[#r.poles + 1] = {type = e.type, at = rel, copper = links}
      end
    end

    out[#out + 1] = r
  end

  helpers.write_file("${DUMP}", helpers.table_to_json(out))
  error("DUMPED-OK")
end)
`
)

writeFileSync(
    join(work, 'config.ini'),
    `[path]\nread-data=${DATA_DIR}\nwrite-data=${writeData}\n[general]\n[other]\n`
)

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
    { encoding: 'utf8', maxBuffer: 1 << 28 }
)
const dumpPath = join(writeData, 'script-output', DUMP)
if (!existsSync(dumpPath)) {
    console.error('No dump. tail:\n' + ((res.stdout ?? '') + (res.stderr ?? '')).slice(-4000))
    process.exit(1)
}
const rows = JSON.parse(readFileSync(dumpPath, 'utf8'))

/* ---------------------------------------------------------------- summary */

const key = p => `${p[0] - 0.5},${p[1] - 0.5}`
const summary = {}
for (const r of rows) {
    const poles = Object.values(r.poles ?? {})
    summary[r.id] = {
        errors: Object.values(r.errors ?? {}),
        ghostsLeft: poles.filter(p => p.type === 'entity-ghost').length,
        poles: Object.fromEntries(
            poles
                .filter(p => p.type === 'electric-pole')
                .map(p => [
                    key(p.at),
                    Object.values(p.copper ?? {})
                        .map(key)
                        .sort(),
                ])
        ),
    }
}
for (const [id, s] of Object.entries(summary)) {
    console.log(
        `\n=== ${id}${s.errors.length ? `  ERRORS: ${s.errors.join(' | ')}` : ''}${s.ghostsLeft ? `  ghosts left: ${s.ghostsLeft}` : ''}`
    )
    for (const [at, links] of Object.entries(s.poles))
        console.log(`    pole ${at} -> [${links.join('  ')}]`)
}

if (WRITE_FIXTURE) {
    writeFileSync(
        FIXTURE,
        JSON.stringify(
            {
                question:
                    'Which copper connections do electric poles end up with when a blueprint is pasted (build_blueprint, then every ghost revived as a robot would build it)?',
                provenance: { binary: binaryLine, pole: POLE, reach: 9 },
                method: 'headless --create; LuaItemStack.import_stack + build_blueprint (build_mode.forced), ghosts revived in x order (C2: reverse), copper connections read with get_wire_connector(pole_copper). Existing poles made with LuaSurface.create_entity before the paste. Positions are tile offsets from each case origin.',
                cases: CASES.map(c => ({
                    id: c.id,
                    existing: c.existing,
                    blueprint: c.bp ? { poles: c.bp.poles, wires: c.bp.wires } : null,
                    at: c.at ?? null,
                    create: c.create ?? null,
                    reverse: !!c.reverse,
                    isolate: !!c.isolate,
                    star: !!c.star,
                })),
                result: summary,
            },
            null,
            2
        ) + '\n'
    )
    console.log(`\nwrote ${FIXTURE}`)
}
