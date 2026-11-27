/*
    The headless editor core: the blueprint model and the string codec, with no
    PixiJS, DOM or editor UI. Imported as `@probe/editor/core` by code that must
    run in Node, a Web Worker or Docker - the scripting engine and its tests.

    Three guards keep it that way:
      - tests/headless/core-imports.test.ts: no core file imports pixi.js, the
        globals, containers/ or UI/;
      - packages/editor/tsconfig.core.json: core type-checks without the DOM
        library (run by tests/headless/core-typecheck.test.ts);
      - tests/headless/no-pixi.test.ts: this entry point loads while pixi.js
        cannot be imported at all.
*/
export { Blueprint, oilOutpostSettings, getFactorioVersion } from './Blueprint'
export type { BlueprintBounds, BlueprintEvents, IOilOutpostSettings } from './Blueprint'
export { Book } from './Book'
export { Entity } from './Entity'
export { Tile } from './Tile'
export {
    decode,
    encode,
    getAndClearLoadWarnings,
    ModdedBlueprintError,
    TrainBlueprintError,
    CorruptedBlueprintStringError,
    BookWithNoBlueprintsError,
} from './bpString'
export { default as FD, loadData } from './factorioData'
export { coreSettings, CoreSettings } from './config'
export { IllegalFlipError } from './errors'
