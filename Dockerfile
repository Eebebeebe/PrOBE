# PrOBE test image: everything the project is tested with, in one container.
#
#   docker build -t probe .                  # builds the default target, "full"
#   docker run --rm probe                    # check + unit + headless + browser suite
#   docker build --target unit -t probe-unit .
#   docker run --rm probe-unit               # the same without the browser suite
#
# Why it is built this way (see README.md, "Testing with Docker"):
#   - Node is pinned to .node-version and npm to the version the lockfile was
#     made with, and dependencies come from `npm ci`, so the image tests exactly
#     the lockfile, like CI does.
#   - Playwright's Chromium and its system libraries are installed by Playwright
#     itself (`install --with-deps`), so the browser matches @playwright/test.
#   - The command is scripts/test-all.sh, the same script a developer runs, so
#     "what Docker tests" and "what was tested locally" cannot drift apart.

FROM node:24.19.0-bookworm AS deps
WORKDIR /repo
RUN npm install -g npm@12.2.3
# Manifests first: this layer (the slow npm ci) is reused until a manifest changes.
COPY package.json package-lock.json .npmrc .node-version ./
COPY packages/editor/package.json packages/editor/
COPY packages/website/package.json packages/website/
RUN npm ci

# No browser: format, lint, type check, unit and headless tests.
FROM deps AS unit
COPY . .
CMD ["scripts/test-all.sh"]

# Everything, including the Playwright browser suite.
FROM deps AS full
RUN npx playwright install --with-deps chromium
COPY . .
CMD ["scripts/test-all.sh", "--e2e"]
