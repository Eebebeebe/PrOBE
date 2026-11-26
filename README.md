# PrOBE

A parametric blueprint editor for [Factorio](https://www.factorio.com), running in the browser.

**Status: early development.** PrOBE currently is a full Factorio blueprint editor
(Factorio 2.0 and Space Age). The goal is to extend it so that blueprint books can
carry JavaScript programs that assemble new blueprints from sub-blueprints and
user-supplied parameters - a far more powerful variant of Factorio's built-in
parametrised blueprints.

## Run it locally

You need Node.js (the version in [`.node-version`](./.node-version)) and npm. The
[Vite+](https://vite.plus) toolchain (`vp`) comes with `npm install`; run it as
`npx vp`, or install Vite+ globally to type plain `vp`.

```sh
npm install
npm run localpreview     # editor on http://localhost:8080, sprite data on :8081
```

Checks and tests:

```sh
npx vp check             # format, lint, type check
npx vp test              # unit tests (no browser needed)
npx playwright install chromium
npx playwright test      # browser tests (needs `npm run localpreview` running)
```

The committed sprite and prototype data in `packages/exporter/data/output` is what the
editor loads; the exporter that produces it needs a Factorio install.

## Credits and license

PrOBE is MIT licensed, see [LICENSE](./LICENSE).

It is built on the work of others:

- [Teoxoy](https://github.com/teoxoy) wrote the original
  [factorio-blueprint-editor](https://github.com/teoxoy/factorio-blueprint-editor).
- [FactoryGameFan](https://github.com/FactoryGameFan) maintained the fork that added
  Factorio 2.0 and Space Age support, which this repository started from.

Factorio is a trademark of Wube Software Ltd. PrOBE is not affiliated with Wube.
