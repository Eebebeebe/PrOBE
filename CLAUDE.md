# PrOBE - Development Guide

## What this is

PrOBE is a web-based Factorio blueprint editor (PixiJS, TypeScript, Vite+) with
Factorio 2.0 and Space Age support. It grew out of `teoxoy/factorio-blueprint-editor`
via the FactoryGameFan fork. The default branch is `main`; day-to-day work happens on
`kurdistan`.

## Project goal

A university project (Studienarbeit). On top of the editor, PrOBE must run
**parametrised JavaScript programs** that build an "instantiated" blueprint:

- A blueprint book contains blueprints plus a program (stored inside the book itself,
  e.g. in a book named `#code`).
- A program exposes `gui()` (the questions to ask the user) and `instance(args)` (builds a
  `Blueprint` by pasting sub-blueprints at computed positions and modifying entities).
- Space Age and **quality** support are mandatory. Rails must work properly.
- Code must be object-oriented, modern ESM, testable via Docker, and open source.

## Monorepo layout

- `packages/editor/` - the editor library. `src/core/` is the model (`Blueprint`, `Book`,
  `Entity`, `bpString.ts`, `factorioData.ts`); `src/containers/` is PixiJS rendering and
  interaction; `src/UI/` is the Pixi-drawn dialogs.
- `packages/website/` - the Vite host page, and the `window.__fbe_test` hook the Playwright
  specs drive (the `fbe` name is historical and deliberately left alone).
- `packages/exporter/` - Rust tool that extracts `data.json` and sprites from a Factorio
  install. Its committed output in `data/output/` is the data source; the bundled `basisu`
  binaries are macOS/Windows only, so it cannot be re-run on Linux.
- `tests/`, `test-blueprints/` - Playwright specs and a corpus of real blueprints.
- `tools/oracle/` - scripts that measure real Factorio behaviour headless (needs the game).
- `docs/legacy/CLAUDE-legacy.md` - the previous maintainers' very detailed notes. Read it
  before touching placement, rails, sprites, paste or the Playwright suite; it records
  many measured pitfalls. Its history and issue numbers refer to the old project.

## Commands

```sh
npm install
npx vp check             # format + lint + type check - run before every commit
npx vp test              # vitest: editor units, scripts/*.test.mjs, tests/*.test.ts
npm run type-check:gate  # CI also runs this after vp check
npm run localpreview     # dev servers: Vite on 8080, sprite data on 8081
npx playwright test      # browser suite; needs localpreview running, workers=1
```

`vp` is not on PATH unless Vite+ is installed globally; `npx vp` uses the local copy.
Run Playwright from the repo root and never with sudo.

## Known issues and open work

- Rails do not behave correctly yet.
- Quality exists only on filters; entities and modules do not model it.
- TODO: `/corsproxy` (used by `?source=` imports, `packages/editor/src/sources.ts`) is only served by the
  Vite dev and preview servers, which proxy it (`packages/website/vite.config.js`) to the
  previous project's production site. A static deployment of `dist/` has no handler, since
  `functions/corsproxy.js` (Cloudflare) was removed. Replace it with a local implementation.
- The core (`packages/editor/src/core`, entry `@probe/editor/core`) is headless: no Pixi, DOM,
  globals, `containers/` or `UI/`. Three guards keep it so: `tests/headless/core-imports.test.ts`,
  `packages/editor/tsconfig.core.json` (no DOM types) and `tests/headless/no-pixi.test.ts`.
  `tests/headless/` also mirrors the corpus fixed points in Node.
- `data.json` is exported from Factorio 2.1.25 and the editor writes blueprint version 2.1.25
  (`core/factorioVersion.ts`). Older blueprints are migrated on load (`core/nameMigrations.ts`).

## Conventions

- Commit subjects carry no issue number; put `Closes #N` in the body.
- `strict` TypeScript, zero errors from `vp check`.
- Never hand-edit generated files (`railSignalSpots.ts`) or test fixtures to make a test pass.
- Do not edit `packages/` while a Playwright run is in flight; Vite reloads the page under it.
