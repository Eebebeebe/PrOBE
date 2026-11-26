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

`scripts/test-all.sh` runs every layer in order (check, unit and headless tests, the
type-check gate) and stops at the first failure; `scripts/test-all.sh --e2e` also starts
the dev servers and runs the browser suite.

## Testing with Docker

The [`Dockerfile`](./Dockerfile) runs everything PrOBE is tested with, in a container, with
nothing installed on the host but Docker:

```sh
docker build -t probe .                     # default target "full"
docker run --rm probe                       # check, unit + headless tests, gate, browser suite

docker build --target unit -t probe-unit .  # the same without the browser suite
docker run --rm probe-unit                  # about a minute
```

How it is built, and why:

- **One image, two targets.** `full` (the default) is "everything that was tested":
  format, lint and type check, the unit and headless Node tests, the type-check gate and the
  Playwright browser suite (about 15-20 minutes). `unit` skips the browser for a fast check.
- **The same script as by hand.** Both targets run `scripts/test-all.sh`, so the container
  cannot test something different from what a developer runs locally.
- **Pinned and reproducible.** Node comes from `.node-version`, npm is the version the
  lockfile was written with, and dependencies are installed with `npm ci`, which fails
  instead of drifting if `package-lock.json` and `package.json` disagree.
- **The browser comes from Playwright.** `npx playwright install --with-deps chromium`
  installs the Chromium build that matches `@playwright/test`, plus its system libraries, so
  the browser suite runs on the officially supported Linux setup.
- **Build context.** `.dockerignore` leaves out `.git`, `node_modules` and generated output.
  The ~460 MB of sprite data in `packages/exporter/data/output` stays in, because the
  browser suite renders with it.

## Credits and license

PrOBE is MIT licensed, see [LICENSE](./LICENSE).

It is built on the work of others:

- [Teoxoy](https://github.com/teoxoy) wrote the original
  [factorio-blueprint-editor](https://github.com/teoxoy/factorio-blueprint-editor).
- [FactoryGameFan](https://github.com/FactoryGameFan) maintained the fork that added
  Factorio 2.0 and Space Age support, which this repository started from.

Factorio is a trademark of Wube Software Ltd. PrOBE is not affiliated with Wube.
