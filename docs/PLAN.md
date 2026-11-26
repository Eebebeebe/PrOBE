# PrOBE: implementation and testing plan for phases 2–5

> **Status: draft, not yet approved.** Produced by a read-only multi-agent research pass
> (7 area readers, 2 independent drafts, 1 judge, 1 critic) on 2026-11-26 at commit
> `a8b59442`. File:line references are as of that commit. Section 7 lists the critic's
> corrections and section 8 the facts checked afterwards; where they disagree with the
> body, sections 7 and 8 win.

The skeleton comes from Draft 2: one commit per step, a test in every commit, and a ratchet so CI stays green. From Draft 1 I took the spikes and their go/no-go fallbacks, the decision rule for #code storage, the worker fallback options, and the History-overhead mitigation. I ordered the oracle work earlier so it runs alongside phase 2.

---

## 1. Summary and key findings that shape the plan

**Summary.** Phase 2 makes `packages/editor/src/core` run in plain Node. Its proof is the existing corpus round trip reproducing the browser's fixed numbers exactly. Phase 3 first fixes the ways load-then-save silently changes a book, then adds the scripting API (paste, upgrade, Book lookup by name) and a new `packages/engine` with a Web Worker sandbox and #code storage. Phase 4 adds the DOM UI: a CodeMirror panel, a parameter dialog and a result box. Phase 5 adds quality and fixes rails. Real-game behaviour (description length limits, quality multipliers, rail flips) is measured with `tools/oracle` before any code depends on it.

**Findings I checked in the repo:**

- **Only three core files reach the render layer:**
    - `core/Blueprint.ts:2` (`import { Sprite, Texture } from 'pixi.js'`), `:16` (`G`), `:390` (`G.debug`), `:713`/`:733` (`G.BPC.wiresContainer`, only reached behind `if (!DEBUG) return` at `:710`).
    - `core/Entity.ts:18` (`IllegalFlipError` from `../containers/PaintContainer`), `:19` (`G`), `:281` (`if (G.BPC.limitWireReach && connectionsBreak) return`). In Node, `G.BPC` is undefined, so this line throws a TypeError.
    - `core/bpString.ts:4` (`G`), `:205` (`if (G.debug) console.log(data)`), `:284` (`fetch('/corsproxy?...')`, only for sources that don't start with `'0'`, see `:269`).
- `core/factorioData.ts:963` prints the whole 4 MB data object with `console.log(data)` on every `loadData`.
- `IllegalFlipError` (`containers/PaintContainer.ts:9-14`) is a plain class and **does not extend `Error`**. `BlueprintContainer.ts:654` checks it with `instanceof`, so it must be moved and re-exported, never copied. While moving it, make it `extends Error`.
- `limitWireReach` really lives in a static: `BlueprintContainer._limitWireReach` (`:67`, getter/setter `:909-914`). `Editor.ts:103-107` writes it and `PaintWireContainer.ts:75` reads it.
- **Book and format bugs:**
    - `Book.ts:13-17`: `blueprints`, `label` and `description` are private, with no lookup by label.
    - `Book.ts:69`: `serialize` renumbers `index`, which closes the gaps in sparse books.
    - `Book.ts:94`: `bps[active_index]` uses a slot number as an array position.
- **Editor entry point:** `@probe/editor` has only `"module": "./src/index.ts"` and no `exports` field. `src/index.ts` imports `Editor`, the containers and the UI, so it can never be headless.
- `bpString.ts:346` exports `encode` and `getBlueprintOrBookFromSource`, but not `decode`.
- **Repo setup:** there is no `packages/engine`, no Dockerfile and no `.dockerignore`. Root workspaces are only `packages/editor` and `packages/website`. `vite.config.ts:203` `test.projects` already has a node `unit` project for `tests/**/*.test.ts`. The precedent for reading `data.json` from disk in Node is `tests/wire-switch-completeness.test.ts:72`.
- `packages/website/public/_headers:4` sets `script-src 'self' 'unsafe-inline' 'unsafe-eval'` and `worker-src blob:`. A worker file emitted by Vite and served from `'self'` would be **blocked in production**.
- **Keyboard guards:** `Editor.ts:736-743` and `website/src/index.ts:715-716` skip only `<input>` and `<textarea>`. CodeMirror is a `contenteditable` div, so editor hotkeys would fire while the user types code (Shift+N clears the blueprint).
- `website/src/toasts.ts:40` sets `text.innerHTML = options.text`. If a shared book's error text goes in there, it can inject HTML.
- **Quality:** entity `quality` is only a comment (`types.ts:552`), and `recipe_quality` is typed (`types.ts:232`). The exporter never exports `data.raw.quality` (no "qualit" in `data-final-fixes.lua`).
- The licence is MIT (`LICENSE`, `package.json:4`). Legacy rule: never edit `packages/` while Playwright runs (`docs/legacy/CLAUDE-legacy.md` ~~:791). Round-trip coverage needs a browser today (~~:797).

**Claims I took from the research notes without re-checking** (the step-by-step plan relies on them): the paste code paths (`PaintBlueprintContainer.ts:175-232`, `PaintBlueprintEntityContainer.ts:136-192`), the quality-dropping writers in Entity.ts, the corpus counts (367 blueprints, 97 with `parameters`, 30 sparse indices), and the description maxima (499/478/442).

---

## 2. Phases

### Ground rules for every phase

- **One commit per step.** `vp check .`, `vp test` and `npm run type-check:gate` stay green. Any step that touches a path Playwright covers also runs the named specs before merging.
- **The test lands in the same commit as the code, or earlier.** For behaviour that doesn't exist yet, use a _ratchet_: an allow-list or count that may only shrink. No skipped tests and no `it.fails`.
- **Fixed points are never re-recorded to make a test pass.** These are the round-trip EXPECTED values, `sprite-data.json` and the oracle fixtures. When a change is meant to move one, it goes in its own "intended change" commit that states the old value, the new value and why (decision D1).
- **Measure real-game behaviour first.** It goes into `tools/oracle/fixtures/*.json` before code relies on it.
- **Spikes run on a scratch branch.** They answer a question and are then thrown away or folded into a proper step.

### Phase 2: headless core

**Goal:** `core/` imports and runs in plain Node with no Pixi, DOM, `G`, `containers/` or `UI/`. Proof:

1. A Node test reproduces the browser round-trip numbers exactly.
2. `docker build && docker run` runs `vp test` successfully.

| #    | Step (files)                                                                                                                                                                                                                                                                                                                                                                                                                  | Tests and acceptance                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.0  | **Spike S2 (scratch branch, not merged):** `tests/headless/smoke.test.ts` loads `data.json` with `console.log` silenced, imports `core/bpString` and decodes one corpus file.                                                                                                                                                                                                                                                 | **Answers:** whether the Blueprint/Entity/PositionGrid/WireConnections import cycle and the `globals.ts → containers/UI` cycle evaluate in Node ESM, and which coupling site fails first. **Fallback if it fails:** do 2.2–2.7 first. If a TDZ error stays inside core, switch the back-imports to `import type` or access them lazily.                                                                                                        |
| 2.1  | **Ratchet and data helper.** New `tests/headless/core-imports.test.ts` and `tests/helpers/load-test-data.ts`.                                                                                                                                                                                                                                                                                                                 | The test reads every `core/*.ts` import and fails on `pixi.js`, `../common/globals`, `../containers/*` or `../UI/*` unless the import is in `KNOWN_VIOLATIONS`. The list starts with exactly Blueprint.ts:2, Blueprint.ts:16, Entity.ts:18, Entity.ts:19 and bpString.ts:4. A listed entry that no longer exists also fails, so the list can only shrink. `loadTestData()` reads `packages/exporter/data/output/data.json` once per test file. |
| 2.2  | **Remove `console.log(data)`** (`factorioData.ts:963`).                                                                                                                                                                                                                                                                                                                                                                       | Node test: under a console spy, `loadData` logs nothing. FD has 155 entities. A splitter's `fast_replaceable_group` is `'splitter'`.                                                                                                                                                                                                                                                                                                           |
| 2.3  | **`core/errors.ts`** with `IllegalFlipError extends Error`. `PaintContainer.ts` re-exports it; `Entity.ts:18` imports it from `./errors`.                                                                                                                                                                                                                                                                                     | Identity test: `PaintContainer.IllegalFlipError === errors.IllegalFlipError`. A Node test: flipping a train-stop throws it. The ratchet drops Entity.ts:18.                                                                                                                                                                                                                                                                                    |
| 2.4  | **`core/config.ts`** `coreSettings = { limitWireReach: true, debug: false }`. Changes: `Entity.ts:281`, `BlueprintContainer.ts:909-914` delegates to it, `PaintWireContainer.ts:75`. `Editor.ts:103-107` stays the only writer.                                                                                                                                                                                               | Node test: with reach limited, moving a pole out of wire reach is refused; with it off, the pole moves. This is the first headless entity-move test. The settings-pane Playwright specs stay green. The ratchet drops Entity.ts:19.                                                                                                                                                                                                            |
| 2.5  | **`G.debug` becomes `coreSettings.debug`** (`Blueprint.ts:390`, `bpString.ts:205`). `Editor.init` copies `G.debug` into it.                                                                                                                                                                                                                                                                                                   | The ratchet drops bpString.ts:4.                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2.6  | **Pipe debug drawing leaves core.** `Blueprint.ts:706-744` emits `'generate-pipes-debug'` with the data on its existing EventEmitter; `BlueprintContainer` draws the Sprites.                                                                                                                                                                                                                                                 | The ratchet drops Blueprint.ts:2 and :16, so the list is now empty. `generators.test.ts` is unchanged.                                                                                                                                                                                                                                                                                                                                         |
| 2.7  | **Split bpString.** Core exports pure `decode(str)` and `encode(x)`. The URL loader (`bpString.ts:262-340`, `/corsproxy`) moves to `packages/editor/src/sources.ts` and is re-exported from `index.ts`, so `__fbe_test` is unchanged.                                                                                                                                                                                         | Node: a string that doesn't start with `'0'` throws a typed error. `blueprint-sources.spec.ts` and `blueprint-string-tolerance.spec.ts` stay green.                                                                                                                                                                                                                                                                                            |
| 2.8  | **Headless entry point and guards.** New `core/index.ts` exporting Blueprint, Book, Entity, Tile, decode, encode, loadData, FD, coreSettings and the errors. `packages/editor/package.json` gets `"exports": {".": "./src/index.ts", "./core": "./src/core/index.ts"}`. New `tsconfig.core.json` with `lib: ["ESNext"]` (no DOM), added to the type-check gate. An oxlint `no-restricted-imports` override for `src/core/**`. | `tests/headless/no-pixi.test.ts` mocks `pixi.js` to throw, then `import('…/core/index')` must succeed; this is also the cycle smoke test. **Mutation check** (by hand, noted in the commit message): adding `import G` to a core file fails all three guards.                                                                                                                                                                                  |
| 2.9  | **Node corpus round trip.** Move EXPECTED from `blueprint-round-trip.spec.ts` (~:192-202) verbatim into `tests/__fixtures__/round-trip.json`, read by both runners. Shared metrics go in `tests/helpers/round-trip-metrics.ts`. New `tests/headless/round-trip.test.ts`.                                                                                                                                                      | **Phase 2 acceptance.** Node gives exactly `{blueprints 367, entities 347725, tiles 232815, wires 48869, icons 956, threw 0, positionChecksum -44031602, modelPositionChecksum -63968586, serializedHash 825830683}`. A difference means a real environment difference (key order, floats, Ajv), which must be explained, never re-recorded. Mutation check: shifting `getOffset` by 1 fails the Node test.                                    |
| 2.10 | **Node mirrors of entity-accessors and book-serialize.** Their expected values move to `tests/__fixtures__/`.                                                                                                                                                                                                                                                                                                                 | Same histograms as Playwright. Keep both runners, because #222 broke the browser bundle path while `checks` was green.                                                                                                                                                                                                                                                                                                                         |
| 2.11 | **Core logger.** `setCoreLogger(fn)` routes the console calls in Blueprint (`generatePipes`), History, `util.timer`, bpString and spriteDataBuilder. `Editor.init` wires it to `G.logger`.                                                                                                                                                                                                                                    | Node: decoding a blueprint with an unknown prototype gives exactly one `warn` to the capture logger and makes 0 console calls.                                                                                                                                                                                                                                                                                                                 |
| 2.12 | **Docker.** `Dockerfile`: `node:24.19.0-bookworm-slim`, `npm i -g npm@12.2.3` (devEngines would otherwise download npm at build time), copy the manifests and `.npmrc`, `npm ci`, copy the sources, `test-blueprints/` and **only** `data/output/data.json`, `WORKDIR` at the repo root, `CMD ["npx","vp","test","run"]`. `.dockerignore` (keeps the ~458 MB of sprites out). A `docker` job in `.github/workflows/ci.yml`.   | `docker build -t probe-test . && docker run --rm probe-test` exits 0. Its test count equals the host's `vp test` count. The build context is under 30 MB.                                                                                                                                                                                                                                                                                      |

### Phase 3a: format fidelity (must come before anything writes into user books)

**Goal:** decoding a real book and encoding it again changes nothing.

| #    | Step (files)                                                                                                                                                                                       | Tests and acceptance                                                                                                                                                                                                                           |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3a.1 | **Baseline ratchet.** `tests/headless/raw-fidelity.test.ts` compares the raw decoded JSON with JSON that went through the model and back, ignoring `version`, and counts differences per category. | The current counts (sparse indices, invented `'Blueprint'` labels, dropped `parameters`/`stock_connections`, lost icon quality, active_index) are pinned in `tests/__fixtures__/raw-fidelity-baseline.json`. They are measured in this commit. |
| 3a.2 | **Keep the slot `index`** (`Book.ts:69`).                                                                                                                                                          | Its category drops to 0 and no other category goes up. Synthetic sparse-book test with exact indices.                                                                                                                                          |
| 3a.3 | **Resolve `active_index` by slot** (`Book.ts:94`).                                                                                                                                                 | A sparse book with an active entry loads the right blueprint and doesn't throw.                                                                                                                                                                |
| 3a.4 | **Write `label` only when the input had one** (`Blueprint.ts:97/131/905`).                                                                                                                         | An unlabelled blueprint stays unlabelled.                                                                                                                                                                                                      |
| 3a.5 | **Pass blueprint `parameters` and `stock_connections` through** (`Blueprint.serialize`).                                                                                                           | That category drops to 0.                                                                                                                                                                                                                      |
| 3a.6 | **Add `quality` to `ISignal` and icons** (`types.ts:21`, `Blueprint.ts:136-138`).                                                                                                                  | Icon quality and type survive.                                                                                                                                                                                                                 |

Each fix that moves `serializedHash` or the checksums is an announced fixed-point move (D1).

### Phase 3b: core model API for scripting

| #    | Step                                                                                                                                                                                                                                                                                                                                                                                                                   | Tests and acceptance (Node, real `data.json`, synthetic blueprints via `tests/helpers/encode-blueprint.ts`)                                                                                                                                                                                                                        |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3b.1 | **`Blueprint.getBounds({railParity?})`**, made public from the private `getCenter` (`Blueprint.ts:545`). Skips placeable-off-grid entities.                                                                                                                                                                                                                                                                            | 1x1, 3x3 and mixed layouts give exact width and height. With `railParity`, the size rounds up to even.                                                                                                                                                                                                                             |
| 3b.2 | **Public label and description setters, and `Blueprint.clone()`.** `clone` deep-copies `serialize()` first, because the constructor mutates its input.                                                                                                                                                                                                                                                                 | Two clones of a wired blueprint both keep every wire.                                                                                                                                                                                                                                                                              |
| 3b.3 | **`Entity.setName(name)`**: in-place upgrade through History. It needs the same fast_replaceable_group and footprint, otherwise it throws. All other raw fields are kept. It does **not** use `fastReplaceEntity`, which drops `type`, quality and control_behavior.                                                                                                                                                   | An upgraded underground keeps `type`, `quality`, control_behavior and its wires (asserted on `serialize()`). Undo restores the old name.                                                                                                                                                                                           |
| 3b.4 | **`Entity.quality` and `recipeQuality` get/set** (`types.ts:552` turned into a real field). The recipe setter (`Entity.ts:369`) clears a stale `recipe_quality`, and a validating variant checks `acceptedRecipes`.                                                                                                                                                                                                    | The values appear in `serialize()`. A wrong recipe gives `InvalidRecipeError`.                                                                                                                                                                                                                                                     |
| 3b.5 | **Headless Book API.** `entries()` returns a tree of `{path, slotIndex, kind, label, description}`. Also `findByLabel(label, {recursive, unique})`, `findAllByLabel`, `getBlueprint(path)` (an independent copy that does not touch `_active`), `setBlueprint`, `addBlueprint`, `addBook`, and label/description accessors. Labels starting with `#` are skipped unless asked for. `selectBlueprint` stays for the UI. | Nested-book and duplicate-label fixtures. `unique` throws `AmbiguousLabelError`. raw-fidelity stays at 0, and the Node round trip (2.9) is unchanged.                                                                                                                                                                              |
| 3b.6 | **Spike S3, then `core/paste.ts`.** `pasteInto(dest, src, offset, {rotate, flip, onConflict: 'error'\|'skip'\|'replace'})`. It plans every entity first, then places them (the two loops from #163), all in one History transaction. It remaps entity numbers, wires, tiles and schedules. The offset must be an integer, and even on both axes when `getFirstRailRelatedEntityPos()` (`Blueprint.ts:524`) is defined. | n pastes give n × the entities, with wires remapped per copy and none cross-linked. A rail blueprint at an odd offset throws `ParityError`. A collision with `'error'` throws `CollisionError` naming the position. The same input gives the same output. **Fallback:** create-only paste for the engine; the GUI stays untouched. |
| 3b.7 | **The GUI uses the core planner.** `PaintBlueprintContainer.placeEntityContainer` and `checkBuildable` call `pasteInto`/`planPlacement`.                                                                                                                                                                                                                                                                               | All six paste-*.spec.ts files stay green unchanged. This is the #181 check that the preview matches the result.                                                                                                                                                                                                                    |
| 3b.8 | **History bypass for scripts:** `Blueprint.withoutHistory(fn)`.                                                                                                                                                                                                                                                                                                                                                        | Pasting a 10k-entity block: measure time and memory with and without it, and record both.                                                                                                                                                                                                                                          |
| 3b.9 | **`core/rates.ts`, without quality for now:** `craftsPerSecond` (`energy_required` defaults to 0.5), `itemsPerSecond` (probabilities, fluids), `machinesForBelt`. `Entity.effectiveCraftingSpeed` delegates to it.                                                                                                                                                                                                     | electronic-circuit in an AM2 on a yellow belt needs exactly 10 machines. U-235 per second from uranium-processing. The existing `recipeIngredientRequests` oracle table stays green.                                                                                                                                               |

### Phase 3c: `packages/engine`, #code storage and sandbox

| #    | Step                                                                                                                                                                                                               | Tests and acceptance                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3c.0 | **Spike S1, the oracle description limits.** Can start in parallel with phase 2 as soon as a Factorio binary exists (D3). `tools/oracle/probe-description-limits.mjs` produces `fixtures/description-limits.json`. | **Carriers:** book and blueprint description and label, and `player_description` on the constant, decider, arithmetic and selector combinators. **Lengths:** 100 to 100000. **Charset case:** CRLF, tab, `\`, `[item=…]`, `]==]`, backtick, `${}`, emoji, 3-byte UTF-8. **Also:** an entity-free blueprint case and a 10-character control. **Payload:** passed by file or base64, never by template interpolation. **Decision rule:** a blueprint description that holds ≥64 KB losslessly → one description per program; otherwise → code split over constant combinators. With no binary, use a provisional 442-character chunk. |
| 3c.1 | **Scaffold** `@probe/engine` (MIT, ESM, depends on `@probe/editor/core`): tsconfig, `test.projects` entry, root workspaces, Dockerfile COPY.                                                                       | A smoke test imports the engine under the throwing pixi mock.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 3c.2 | **Script API classes** (section 3).                                                                                                                                                                                | Empty `first()` throws `EmptyQueryError`. A bad `set_recipe` is rejected. `upgrade_all('fast-transport-belt')` maps belts, undergrounds and splitters by tier and keeps `type` and quality. `width` comes from `getBounds`.                                                                                                                                                                                                                                                                                                                                                                                                         |
| 3c.3 | **`ParamTypeRegistry` and GuiSpec validation.**                                                                                                                                                                    | For each type, the options come from FD and invalid values are rejected. A malformed `gui()` gives `GuiSpecError` with the key path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 3c.4 | **`Program` and `InProcessSandbox`** (`new Function`).                                                                                                                                                             | A program without `instance` gives a compile error. `gui` is optional.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 3c.5 | **End-to-end example** (the user's pseudocode) on a fixture book (D2).                                                                                                                                             | The output decodes. Entities = n × the basic_block count. Every assembler has the chosen recipe and every belt the chosen tier. No overlaps. Copies sit at x = i·width.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 3c.6 | **`CodeStore` and `ChunkCodec`**, using the limits read from the 3c.0 fixture.                                                                                                                                     | Byte-identical round trip, including the charset case and chunk boundaries. A changed chunk gives `CodeIntegrityError`. Reordered carriers still assemble. raw-fidelity of the user's own blueprints stays at 0. **Oracle follow-up:** the game imports what `writeProgram` produces and gives the code back unchanged.                                                                                                                                                                                                                                                                                                             |
| 3c.7 | **Spike S4, then the worker sandbox.** `SandboxClient` plus `NodeWorkerTransport` (worker_threads) and `InlineTransport`.                                                                                          | Protocol tests over both transports. `while(true){}` gives `TimeoutError` within timeout + 500 ms, and the next run works on a fresh worker. Errors keep name, message and line. Logs arrive before the result.                                                                                                                                                                                                                                                                                                                                                                                                                     |

### Phase 4: DOM UI (`packages/website`)

| #   | Step                                                                                                                                                                              | Tests and acceptance                                                                                                                                           |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4.1 | **`isEditableTarget()`**: input, textarea, `isContentEditable`, or inside `[data-probe-dom-ui]`. Used in `Editor.ts:734-747` and `website/src/index.ts:714-716`. **Lands first.** | Unit test. Playwright: typing `eqrx12`, Shift+N and `i` into a contenteditable changes nothing (editor mode, dialogs, info panel and blueprint are unchanged). |
| 4.2 | **`toasts.ts` gets a `textContent` option** for untrusted text.                                                                                                                   | Text containing `<img onerror>` creates no element.                                                                                                            |
| 4.3 | **`BookSession`** replaces the `bp`/`book` module variables (`index.ts:66-69`), exposed as `__fbe_test.programSession` (type in `tests/helpers/fbe-test-api.ts`).                 | All existing specs stay green.                                                                                                                                 |
| 4.4 | **Worker build and CSP:** Vite `worker: {format:'es'}`, and `_headers` `worker-src 'self' blob:`. Fallback: `?worker&inline`, then a sandboxed iframe.                            | A unit test parses `_headers`. A test against a production build (`vp build` plus preview) shows the worker answers `describe`.                                |
| 4.5 | **`CodePanel`**: CodeMirror 6, loaded lazily, as a right-side drawer marked `data-probe-dom-ui`. `tests/helpers/overlays.ts` learns the new selector.                             | Keyboard spec. Overlay spec: with the drawer open, the point outside it still hits the canvas. Startup bundle size unchanged.                                  |
| 4.6 | **`ParamDialog`**: a native `<dialog>`, labels set with textContent only. The pure GuiSpec→fields→args functions live in the engine.                                              | Vitest for the form model. Playwright: options show localised names and submit internal names.                                                                 |
| 4.7 | **`ProgramController` and result box**: Copy, Open in editor, Add to book.                                                                                                        | program-run.spec: fixture book → Run → fill the dialog → the result string decodes to the expected counts and recipes.                                         |
| 4.8 | **Save/Load code in the book.** A list of labels replaces the dat.gui index slider.                                                                                               | program-roundtrip.spec. program-sandbox.spec: an infinite loop gives a timeout while the canvas stays responsive.                                              |

### Phase 5: quality and rails

**Quality.** The probe is measured first.

1. **`tools/oracle/probe-quality.mjs` → `fixtures/quality.json`.** It records `get_crafting_speed(q)`, inserter, belt and beacon values at each quality, and whether exported JSON omits `quality` for normal. Acceptance: the fixture is committed. The multiplier is either confirmed as `1 + 0.3·level` (legendary = 5) or the table is used directly.
2. **Exporter `output.qualities = data.raw.quality`.** Then FD gets `qualities` and pure `qualityLevel(name?)`. Regenerating `data.json` is a fixed-point move (D1). Test: normal through legendary resolve, and an unknown name throws.
3. **Fix each writer that drops quality, one commit each, each with a Node test on `serialize()`:**
    - the splitter filter (`Entity.ts:692-713`, including the always-false compare)
    - modules as `{name, quality}` slots with a `break` (`Entity.ts:433-507`)
    - `fastReplaceEntity` (`Blueprint.ts:437`)
    - `pasteSettings` (recipe_quality and module quality)
4. **`rates.ts` gets quality from the fixture.** Expected AM3 at levels 0/1/2/3/5: 1.25 / 1.625 / 2.0 / 2.375 / 3.125. Only positive module effects are scaled, and consumption floors at -0.8. Also engine `upgrade_all(…, {quality})`, `recipe(...).rate({quality})`, and a quality select in the UI.
5. **Round-trip test:** a legendary AM3, an epic module, recipe_quality rare and an uncommon splitter filter come back deep-equal.

**Rails.** The user's input comes first (D4).

1. **Commit each failing string as a fixture**, labelled sprite, geometry or placement.
2. **Normalise `rail.direction`** before the spot lookup in `railSignalSnapping.ts`. Pure test: a straight rail at direction 8 snaps like direction 0.
3. **Oracle probes:** the flip map per rail prototype, the rail-ramp/rail-support lattice, and editor output through `probe-editor-output.mjs`. Then make `getFlippedCopy` table-driven, and extend `getFirstRailRelatedEntityPos` and `railRelatedNames` to elevated rails, ramps and supports. Each rule is checked against every measured row.
4. **Sprite digests for rails at directions 2/6/10/14** go in a **new** fixture file, so `sprite-data.json` doesn't move. Never hand-edit `railSignalSpots.ts`.
5. **Headless paste parity test** (built on 3b.6).

---

## 3. `packages/engine` design

### Example program

This is the user's pseudocode, which the API must run as written:

```js
function gui() {
    return { belt_type: { type: 'belt_type' }, recipe: { type: 'assembly_machine_recipe' } }
}
function instance(args) {
    const bb = factorio.get_blueprint('basic_block')
    bb.filter_entity('assembly_machine').first().set_recipe(args.recipe)
    bb.filter_entity('belt').upgrade_all(args.belt_type)
    const n = factorio.machines_for_belt(args.belt_type, args.recipe, 'assembling-machine-2')
    const result = new Blueprint()
    for (let i = 0; i < n; i++) result.paste(bb, i * bb.width, 0)
    return result
}
```

### Classes (ESM and TypeScript inside; snake_case names in script scope)

```
Engine                      facade for the website and tests
  constructor({sandbox, logger?})
  loadBook(str) -> BookHandle;  listPrograms(); describe(program) -> Promise<GuiSpec>
  run(program, args) -> Promise<{blueprintString, stats, logs}>;  saveProgram(program) -> string
FactorioApi  (global `factorio`)
  get_blueprint(label)       Book.findByLabel(unique), '#' labels excluded, returns an independent clone
  recipe(name).rate(machine,{quality}), belt(name).throughput, machines_for_belt(...), qualities()
ScriptBlueprint  (exposed as `Blueprint`)
  constructor(); width; height (getBounds, rounded up to even if rails); label; description
  filter_entity(selector) -> EntityQuery
  paste(src, x, y, {rotate?, flip?, on_conflict?})    core pasteInto; x,y = top-left of src bounds
  to_string()
EntityQuery (immutable, iterable)   first() | all() | count | filter(fn) | set_recipe(name, quality?)
                                    upgrade_all(target, {quality?: 'keep'|name})  (default 'keep')
ScriptEntity    name, type, position, direction, quality, recipe, set_recipe(), upgrade(to)
EntitySelector  aliases ('belt' -> transport-belt|underground-belt|splitter;
                'assembly_machine' -> type assembling-machine) | prototype name | type | predicate
UpgradeResolver tier mapping per family via FD next_upgrade chains
ParamTypeRegistry  register(type, {options(FD), validate(v)}); GuiSpec validate / specToFields / fieldsToArgs
Program {name, code, version};  CodeStore read(book)/write(book, program);  ChunkCodec
Sandbox interface: InProcessSandbox (tests only) | SandboxClient (timeout, terminate, respawn)
Transport interface: BrowserWorkerTransport | NodeWorkerTransport | InlineTransport
ScriptHost (inside the worker): loadData once; new Function('factorio','Blueprint','console', code + '\nreturn {gui, instance}')
Errors: ScriptError <- BlueprintNotFoundError, AmbiguousLabelError, EmptyQueryError, InvalidRecipeError,
        CollisionError, ParityError, GuiSpecError, TimeoutError, CodeIntegrityError, StorageLimitError
```

**Rules:**

- The engine imports only `@probe/editor/core`.
- Script-facing objects keep the core objects private.
- Every error is a typed `ScriptError` that can be serialised as `{name, message, line?}`.

### Worker protocol (v1)

Only JSON and strings cross the boundary. Blueprints travel as encoded strings.

```
main -> worker   {v:1, type:'init', dataJson}                      -> {v:1, type:'ready'} | {type:'init-error', error}
                 {v:1, id, type:'describe', code, book}            -> {id, type:'result', ok:true, value: GuiSpec}
                 {v:1, id, type:'run', code, args, book, limits:{maxEntities}}
                                                                   -> {id, type:'result', ok:true, value:{blueprintString, stats}}
worker -> main   {v:1, id, type:'log', level, text}  |  {v:1, id, type:'error', error:{name, message, stack?, line?}}
```

- There is no cancel message. A timeout (default 10 s) triggers `terminate()` and a reject, and the worker respawns lazily (about 124 ms to parse `data.json`).
- One request runs at a time and the rest are queued.
- An unknown `v` or `type` gets an error reply.

### #code storage format

- A nested book labelled `#code` inside the user's book, so one string carries both code and layouts. There is one pseudo-blueprint per program, labelled with the program name.
- The blueprint description holds a short readable manifest: `#probe v1`, the entry point and a parameter summary.
- The code goes in the carrier that 3c.0 picks:
    - (a) the blueprint description, if it holds ≥64 KB losslessly, or
    - (b) constant-combinator `player_description` chunks, each starting with `#probe v1 part i/n sha256=<hash of the whole program>`.
- Order comes from the header, not from entity order. The checksum is verified on load.
- Writes never touch entries outside `#code` (raw-fidelity stays at 0).
- Until a graphics-client probe measures the in-game text box cap, the docs say: do not edit `#code` inside the game.

---

## 4. Testing strategy

| Layer                            | Where                                                                  | Runs in                          | What it covers                                                                                                                                                   |
| -------------------------------- | ---------------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pure unit                        | `packages/editor/src/**/*.test.ts`, `packages/engine/src/**/*.test.ts` | `vp test` (CI `checks`, Docker)  | rates, selectors, chunk codec, GuiSpec form model, rail direction maps                                                                                           |
| Node headless (real `data.json`) | `tests/headless/*.test.ts` (root `unit` project)                       | `vp test`, Docker                | corpus round trip and accessor histograms at the browser's exact numbers, raw fidelity, paste, upgrade, Book API, example program, import ratchet, no-pixi guard |
| Sandbox                          | engine tests over `NodeWorkerTransport`                                | `vp test`                        | protocol, timeout, error serialisation                                                                                                                           |
| Playwright                       | `tests/*.spec.ts` (existing 44 plus new `program-*.spec.ts`)           | CI `e2e`, 4 shards               | browser bundle path (#222), keyboard routing, overlay, real Worker, CSP, UI flow                                                                                 |
| Oracle                           | `tools/oracle/probe-*.mjs` → `fixtures/*.json`                         | by hand, needs a Factorio binary | description limits, quality multipliers, rail flip and lattice, re-import of editor output                                                                       |
| Static                           | `vp check`, `tsconfig.core.json`, oxlint import rule                   | CI `checks`                      | core stays headless                                                                                                                                              |

**CI:** keep `checks` (it already runs every vitest project). Add a `docker` job running `docker build && docker run`. Keep the sharded `e2e`. The oracle stays offline, with committed fixtures only.

**Discipline:**

- Fixed points move only in announced commits.
- Prefer synthetic blueprints for new features, because adding corpus files moves five fixture sets.
- Mutation-check every new guard.
- Never edit `packages/` during a Playwright run.

---

## 5. Risks

1. **Core may not evaluate in Node ESM** (import cycles or TDZ). This is inferred, not measured, which is why spike 2.0 and the 2.8 smoke test come first.
2. **No Factorio binary on this machine** (`FACTORIO_BIN` is unset). The #code design and quality multipliers stay provisional, at 442-character chunks and the wiki formula.
3. **Book corruption** (sparse indices, invented labels, dropped `parameters`) if #code writes land before 3a. The order of the phases prevents this.
4. **Production CSP blocks the worker.** Covered by 4.4's test and fallbacks.
5. **Keyboard capture in CodeMirror** (Shift+N clears the blueprint). Covered by 4.1, which lands first.
6. **Untrusted code from shared books.** Never auto-run: show the source, require a Run click, run in the Worker with a timeout, and render all text with textContent (fixes `toasts.ts:40` innerHTML).
7. **Rail parity and half-tile parity in `paste`.** Integer offsets are enforced, and even offsets when rails are present.
8. **Quality loss** through `fastReplaceEntity`, module writes and splitter filters. `setName` avoids the first path, and phase 5 fixes the writers.
9. **History overhead** for scripts creating thousands of entities. Covered by 3b.8.
10. **One FD per worker:** about 4 MB of JSON parsed per worker. Use one long-lived worker and respawn it only after a timeout.
11. **Docker npm version:** devEngines requires npm 12. Pin it explicitly in the Dockerfile.

---

## 6. Decisions and inputs needed from the user

- **D1 Fixed-point moves:** may the format fixes (3a) and the quality `data.json` regeneration (phase 5) move the round-trip numbers, in explicit "intended change" commits?
- **D2 Example input:** please send the real book string containing `basic_block`. Which belt and recipe does it use? Does `belt_type` mean a prototype name (for example `fast-transport-belt`)? Should rate maths assume stacked belts?
- **D3 Oracle:** can you provide a Linux headless Factorio (for example the `factoriotools/factorio` Docker image; it needs your licence)? Which versions should we target: 2.0.7x, 2.1.x, or both?
- **D4 Rails:** what exactly breaks (rendering, placement, rotate/flip, paste or round trip)? Please send the strings, screenshots from PrOBE and Factorio, the action you took and the game version. Are pre-2.0 rails in scope?
- **D5 `paste()` rules:** on a collision, throw or skip? With rails and an odd offset, throw or snap? Should power poles between pasted copies be connected automatically?
- **D6 #code location:** a nested `#code` book inside your book, or a separate top-level book? Do you need to edit code inside the game?
- **D7 Program output:** should the result replace the loaded blueprint, be added to the book, or only go to the clipboard?
- **D8 Hosting:** is production still Cloudflare Pages (`_headers`)? May `worker-src` be widened to `'self' blob:`?
- **D9 Docker for grading:** is `docker run` with `vp test` enough? Should it also run `vp check`, or have an optional e2e image?
- **D10 Rates scope:** machine and module quality only, or beacons and surface effects too?

**Key files:**

- /home/eebe_beebe/Projects/PrOBE/packages/editor/src/core/{Blueprint,Entity,Book,bpString,factorioData}.ts
- /home/eebe_beebe/Projects/PrOBE/packages/editor/src/containers/{PaintContainer,BlueprintContainer,PaintBlueprintContainer,PaintBlueprintEntityContainer,PaintWireContainer}.ts
- /home/eebe_beebe/Projects/PrOBE/packages/editor/src/Editor.ts
- /home/eebe_beebe/Projects/PrOBE/packages/editor/package.json
- /home/eebe_beebe/Projects/PrOBE/packages/website/src/{index,toasts}.ts
- /home/eebe_beebe/Projects/PrOBE/packages/website/public/_headers
- /home/eebe_beebe/Projects/PrOBE/vite.config.ts
- /home/eebe_beebe/Projects/PrOBE/tests/wire-switch-completeness.test.ts
- /home/eebe_beebe/Projects/PrOBE/tools/oracle/
- /home/eebe_beebe/Projects/PrOBE/docs/legacy/CLAUDE-legacy.md

---

## 7. Corrections from the critic (to be folded into the steps)

**Wrong or imprecise claims**

1. **Book.ts:94 also crashes on empty books, not only sparse ones.** `getFlattenedActiveIndex` destructures `bps[active_index]` (Book.ts:92-94), so a book with `blueprints: []` or no `blueprints` throws a TypeError. This matters for an empty `#code` book or a new book built by a script. 3a.3 should add an empty-book test, and 3b.5's `addBook` depends on it.
2. **The Dockerfile in 2.12 doesn't match CI.**
    - CI installs with `.github/actions/setup-vp` and `vp install --frozen-lockfile` (ci.yml:30-33). The plan uses `npm i -g npm@12.2.3` and `npm ci`.
    - The node and npm versions (24.19.0, 12.2.3) are not anchored anywhere in the repo.
    - Fix: reuse the setup-vp installer and checksum, or justify the divergence.
    - The image must also COPY `scripts/`, because the `gate` project runs `scripts/*.test.mjs` (vite.config.ts:209-211).
    - "Test count equals host" can fail on its own: `localpreview.test.mjs` skips its IPv6 test when `::1` is missing, which is common in Docker. Compare passed + skipped, not passed.
3. **3b.6 checks rail parity with an incomplete detector.** `getFirstRailRelatedEntityPos` (Blueprint.ts:524-536) knows only legacy, straight, half-diagonal and curved-a/b rails and train-stop. Elevated rails, rail-ramp and rail-support are missing, and `data.json` contains them (`elevated-straight-rail` and `rail-ramp` both appear). An elevated-rail block at an odd offset would pass the ParityError check. Move the detector extension from phase 5 into 3b.6, or 3b.1 for `railParity`.
4. **3a.4 cites the wrong mechanism.** The invented label comes from `public name = 'Blueprint'` (Blueprint.ts:98), applied only `if (data.label)` (:131), and from `label: this.name` (:905).
    - Related: the `description` field is private and readonly (:107).
    - Also: `serialize` always calls `generateIcons()` when icons are empty (:856-858). That invents icons on icon-less blueprints, including #code pseudo-blueprints, so add it as a raw-fidelity category.
5. **D11 is mostly answerable from the repo.**
    - The repo is on branch `kurdistan`, with a clean tree, 1 commit ahead of upstream (HEAD a8b59442).
    - Git user.name is already `Eebebeebe`, and the last commit's author is the user.
    - So "push in my name" probably needs no new identity, only a separate step with push permission and no Claude co-author trailer, which the harness attribution reminder would otherwise add.
    - The plan should say this and not leave it as an open question.

**Missing requirements** 6. **Sandbox hardening in the worker.**

- A same-origin worker running `new Function` can still reach `fetch` and `XMLHttpRequest` (CSP `connect-src 'self'`), `indexedDB`, `caches`, `importScripts`, `WebSocket` and `postMessage` spoofing of the protocol.
- Add a step to 3c.7/4.4: delete or freeze these globals before the user code runs, validate every outbound message against protocol v1, and write a test that `fetch`/`indexedDB` are undefined inside a script.
- `NodeWorkerTransport` (worker_threads) has full `fs` and `process` access. State that the Node transport is for tests only, never for untrusted books, or use `vm` plus `resourceLimits`.
- The `limits.maxEntities` guard needs its own test.

7. **#code entries are visible and editable in the existing UI before 4.8.** Today's index slider walks every flattened blueprint (`countNestedBlueprints`, Book.ts:81). Once 3c.6 writes `#code`, users can open a carrier in the GUI. `Blueprint.serialize` would then re-center positions (:862-880) and regenerate icons. Either hide `#`-labelled entries in the website as soon as 3c.6 lands, or pull 4.8's label list forward.
8. **Underground downgrade or upgrade can break pairs.** `upgrade_all` across tiers changes `max_distance` (Entity.ts:1315-1322 reads it). Downgrading express (9) to yellow (5) can unpair undergrounds. 3b.3/3c.2 should validate this and throw, or report it, with a test.
9. **Upgrades must respect families.** factorioData.ts:978-982 overrides `fast_replaceable_group` so splitters and undergrounds get their own groups. Mapping a single `belt_type` (for example `fast-transport-belt`) onto splitter and underground needs a tier index from `next_upgrade` chains. They exist in `data.json` (transport → fast → express → turbo for belt, underground and splitter). The `UpgradeResolver` test should cover the turbo tier (Space Age) and an unknown or non-belt target.
10. **Space Age is barely in the acceptance criteria.**
    - The `assembly_machine_recipe` options and the 3c.5 example should cover Space Age machines and recipes: foundry and electromagnetic-plant are in data.json, and the turbo belt tier.
    - 80 `surface_conditions` occurrences are in `data.json`. Decide whether recipe options are filtered by surface.
    - `machines_for_belt` should take the machine from `bb` (the first assembler's name), not a hardcoded `"assembling-machine-2"`, since the user's pseudocode passes only belt and recipe.
    - Define which rate is matched to the belt (main product, or max over ingredients and products), and whether it is per lane or whole belt. Add this to D2.
11. **Quality in the GUI types is missing from phase 3.** `gui()` types for quality are absent: `belt_type` and `assembly_machine_recipe` with a quality, or a `quality` type. Phase 5 adds a UI select, but 3c.3's registry should reserve `quality` now so phase 5 doesn't change the GuiSpec format.
    - Module quality is partly typed already (`BlueprintItemIDAndQualityIDPair.quality`, types.ts:~85). Phase 5 should build on it.
    - "legendary" appears 0 times in data.json, which confirms the exporter gap.
12. **Licence and third parties.** LICENSE already carries the Teoxoy, FactoryGameFan and PrOBE copyrights. Add a step:
    - `@probe/engine` package.json gets `"license": "MIT"`, author and contributors.
    - Check the licences of new dependencies (CodeMirror is MIT).
    - Bundled Factorio data and sprites are not MIT. Docs and the Docker image should say the game assets are not redistributed, or mark them as excluded.
13. **`/corsproxy` has no production handler** (CLAUDE.md TODO; website vite.config.js:25-27). 2.7 moves the loader but doesn't fix this. Either add it as a tracked item or say it is out of scope.

**Steps too large, untestable or misordered** 14. Split these steps: - **3b.5 Book API:** entries/find, getBlueprint copy, mutation (set/add/addBook). - **3b.6 paste:** planner, entity-number and wire remap, tiles, schedules. - **3c.2 script API:** `EntityQuery`/selector, `ScriptBlueprint`/paste, upgrade. 15. **2.8 mutation check "by hand, noted in commit message"** is not reproducible. Make it an automated test that runs the import-ratchet scanner on an in-memory fixture containing `import G`. 16. **2.9 "exactly the browser numbers"** may differ legitimately. Ajv and the `version` from `getFactorioVersion` are the same, but key order depends on code paths. The plan already says differences must be explained, not re-recorded. Add a time-boxed fallback in case the difference is environmental, such as per-file diffing tooling. 17. **3b.8 has no pass/fail criterion** ("measure and record"). Give it a budget, for example 10k entities in under N s, or label it a measurement spike. 18. **Ordering of 3c.0 and 3c.6.** 3c.0 needs a Factorio binary, and `FACTORIO_BIN` is unset. 3c.6 still lands with the provisional 442-character chunks. Make `ChunkCodec` take the limit as a parameter from day one, so the later oracle result changes only a fixture and not the format version. Also record which game version the 499/478/442 maxima came from; that is unverified, and there is no description-limits fixture in tools/oracle/fixtures.

**Missing user decisions** 19. Add these to section 6: - **(a)** Must the Docker image also run Playwright e2e for grading? CLAUDE.md:20 says only "testable via Docker". D9 partly covers this. - **(b)** Which game version and mod set the Studienarbeit targets for Space Age. Base-only books must keep working. - **(c)** Must programs be able to read or modify _other_ books, or only the one that contains `#code`? - **(d)** Is auto-connecting power poles between copies (D5) in scope for the user's example? A pasted assembler row without poles is useless in-game.

---

## 8. Facts checked after the review

- **Factorio is installed:** Steam runs as a Flatpak, so the game is at
  `~/.var/app/com.valvesoftware.Steam/.local/share/Steam/steamapps/common/Factorio/bin/x64/factorio`.
  It is **version 2.1.25** (linux64, Steam), and `--version` runs. So Risk 2 is not a blocker, and spike S1
  (description limits) can run on this machine. The oracle scripts take `FACTORIO_BIN`.
- **Version mismatch to decide (part of D3):** `data.json` and the oracle fixtures come from 2.0.x (tools/oracle/README.md
  names 2.0.45–2.0.73), and the editor writes blueprint version 2.0.45
  (`core/factorioVersion.ts`). The installed game is 2.1.25. Measurements taken there must state their
  version.
- **Already resolved:** push identity (old D11). Commits are authored as Eebebeebe and pushed over SSH.
  Hosting (D8): the Cloudflare deploy target was removed in Phase 1, so there is no production host right now.
- **Baseline before phase 2:** `vp check` clean, `vp test` 184/184, Playwright 198/198 (14.7 min, workers=1,
  Arch Linux with the fallback Ubuntu Chromium).

---

## 9. Decisions from the user (2026-11-26)

These override the open questions in section 6 and the critic's section 7.

1. **Example input (D2):** the user's book is committed as `tests/__fixtures__/books/basic-builder.txt`
   (deliberately not under `test-blueprints/`, whose files feed the fixed corpus numbers).
   It is one blueprint labelled **"Basic builder"** (6×7 tiles, game version 2.1.25.10): 2× assembling-machine-3
   with 2× productivity-module-2 each on `logistic-science-pack`, express belts top and bottom (direction 4),
   4 fast inserters, 2 medium poles joined by one copper wire. More fixtures may be added as needed.
2. **Target version (D3):** the **newest game version** (2.1.25 installed here). Quality and elevated rails are
   mandatory. So `data.json` must eventually be regenerated from 2.1.x, and the blueprint version the editor
   writes (`core/factorioVersion.ts`, now 2.0.45) must follow. The exporter's `basisu` binaries are
   macOS/Windows only, so building basisu from source on Linux becomes a work item.
3. **Code storage (D6):** the code must be editable; where it lives is open. Measure the character limits of
   blueprint/book descriptions **and** constant-combinator descriptions (comment field) in the real game
   (spike S1) before choosing. A blueprint book is the preferred container.
4. **`paste()` (D5):** behave like Factorio. On a collision, throw an error that names what is in the way
   (entity name and position). Power poles connect between pasted copies the way the game does it.
5. **Program output (D7):** offer as many options as practical (copy string, open in editor, add to book,
   download), but **never replace anything automatically**.
6. **Docker (D9):** the user leaves this to us, as long as the final Dockerfile runs everything that was tested.
   The choice and the reasons go in the README when the Dockerfile lands.

---

## 10. Findings since the plan was written

**Spike S2 (core in Node), done.** Under Vitest the core already imported, loaded `data.json`, decoded
the Basic builder book and re-encoded it. The only difference was the book `version` (2.1.25 in, 2.0.45 out),
so the import-cycle risk is retired. Phase 2 steps 2.1–2.7 have since landed. The core imports no `pixi.js`,
globals, `containers/` or `UI/` (`tests/headless/core-imports.test.ts`), and the URL loader moved to
`packages/editor/src/sources.ts`.

**Spike S1 (text limits), done. This replaces the 499/478/442 figures assumed above.** Source:
`tools/oracle/probe-text-limits.mjs` and `tools/oracle/fixtures/text-limits.json`, Factorio 2.1.25. An
independent re-run confirmed every boundary.

| Carrier                                                         | Limit                                       |
| --------------------------------------------------------------- | ------------------------------------------- |
| blueprint / book `description`, nested blueprint `description`  | 500 bytes UTF-8                             |
| blueprint / book `label`                                        | 200 bytes                                   |
| constant / decider / arithmetic combinator `player_description` | 500 bytes                                   |
| display-panel `text`                                            | 500 bytes; train-stop `station`: 1024 bytes |
| **entity `tags`** (no in-game UI)                               | **no limit found** (128 MiB exact)          |
| top-level blueprint / book `tags`                               | not kept at all                             |

- **How truncation works:** the game cuts silently, by byte (possibly mid character), and still reports a
  successful import. PrOBE must measure UTF-8 bytes itself and refuse, or cut at a code-point boundary.
- **Empty strings:** an empty description or label is dropped on export.
- **Tags and building:** entity tags survive import and export, the library and ghosts. They are **lost when
  the entity is built in the world and re-blueprinted**, but `player_description` survives that.

**Consequence for storage (D6), still to be confirmed with the user:**

- **Code:** the program goes in a constant combinator's `tags` inside a `#code` blueprint.
- **Marker:** `player_description` holds a short marker with a hash, so a lost program is detected and
  explained instead of looking like "no code".
- **In-game editing:** that is only possible for code under 500 bytes, or by splitting it across several
  combinator comments, which is fragile. The primary editor is the browser.

---

## 11. `#code` storage: editable in the browser _and_ in the game (supersedes D6 and the 3c.6 format)

Measured with `tools/oracle/probe-code-in-combinators.mjs` (Factorio 2.1.25, independently re-run):

- Constant-combinator `player_description` survives every path tested: import/export, ghosts, building, revive,
  recapture, clone, copy-settings, rotation and flips.
- Entity `tags` survive only while the blueprint has never been built. Reviving the ghosts drops them.
- `entity_number` carries no order. Import renumbers 1..N in array order; a recapture numbers by world position
  (x, then y).
- Geometry cannot recover chunk order either. A horizontal flip reverses a row and leaves no marker, and a vertical
  flip looks exactly like a 180° rotation.
- Editing one comment in the world changes only that chunk.
- An over-long edit is cut at 500 **bytes**, by raw byte. It can leave invalid UTF-8 and still re-imports with no
  error.
- Recapturing into an existing stack keeps its label but clears its description.

**Format.**

- **Location:** the user's book holds a nested book labelled `#code`. Each program is one blueprint in it, labelled
  with the program name (≤ 200 bytes). That blueprint is a row of constant combinators.
- **Chunk content:** each combinator's `player_description` is one chunk, starting with a header line
  `//#probe <i>/<n>` followed by a newline and then the chunk body. The program is the bodies concatenated in
  header order.
- **How the writer splits the code:**
    - It splits at line ends where possible, and otherwise at UTF-8 code-point boundaries.
    - Each chunk stays at **≤ 400 bytes including the header**, so an in-game edit has about 100 bytes of headroom
      before the game's silent cut at 500.
    - It always writes non-empty chunks.
- **Backup:** the first combinator's `tags` hold `{probe_v: 1, code, sha256}` as a full backup. Tags do not survive
  building, so the comments are the primary store.

**Reading, and what PrOBE tells the user:**

| Situation                   | Detected by                                                          | PrOBE does                                                                 |
| --------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| In sync                     | tags present, sha256(program) = tags.sha256                          | load silently                                                              |
| Edited in game              | tags present, hash differs                                           | load the comments (the newer text), say so, offer the tags version         |
| Came back from the world    | no tags                                                              | load the comments                                                          |
| Cut off in game             | a chunk is exactly 500 bytes or ends in an incomplete UTF-8 sequence | warn and name the chunk; offer the tags version if any                     |
| Chunk missing or duplicated | header indices                                                       | error naming the missing or duplicate `i/n`                                |
| Header line deleted in game | no `//#probe` header                                                 | fall back to position order (y, then x) and warn that the order is a guess |

**Editing.** The browser editor always edits the whole program as one text. Saving re-chunks it and rewrites the
tags, so a chunk that grew in the game is redistributed. In the game, the player edits a comment and keeps its first
line.

**Open, needs the user:** whether the in-game comment text box itself stops typing at 500 characters or bytes. That
can only be checked in the game's GUI, not headless.
