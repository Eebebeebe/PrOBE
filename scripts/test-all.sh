#!/usr/bin/env bash
# Runs every PrOBE test layer in order and stops at the first failure:
#   1. vp check               format + lint + type check
#   2. vp test                unit and headless (Node) tests
#   3. type-check gate        the same gate CI runs
#   4. Playwright (--e2e)     browser suite against `npm run localpreview`
#
# Used as the Docker image's command and runnable by hand from the repo root:
#   scripts/test-all.sh           # layers 1-3, no browser, about a minute
#   scripts/test-all.sh --e2e     # all four, about 15-20 minutes
set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n=== %s ===\n' "$1"; }

step 'vp check'
npx vp check
step 'vp test'
npx vp test
step 'type-check gate'
npm run -s type-check:gate

if [[ "${1:-}" == "--e2e" ]]; then
    step 'Playwright (browser suite)'
    log=$(mktemp)
    npm run localpreview >"$log" 2>&1 &
    servers=$!
    trap 'kill "$servers" 2>/dev/null || true' EXIT
    for i in $(seq 1 120); do
        if curl -sf -o /dev/null http://localhost:8080 && curl -sf -o /dev/null http://localhost:8081; then
            echo "dev servers up after ${i}s"
            break
        fi
        if ! kill -0 "$servers" 2>/dev/null; then
            echo 'localpreview exited early:' >&2
            cat "$log" >&2
            exit 1
        fi
        sleep 1
        if [[ $i == 120 ]]; then
            echo 'dev servers did not come up within 120s:' >&2
            cat "$log" >&2
            exit 1
        fi
    done
    npx playwright test
fi

printf '\nAll requested test layers passed.\n'
