# Albert Deep Dive.
#
# The print renderer drives a real Chromium to lay the pages out, so the image is built on
# Playwright's own, which already carries that browser and the system libraries and fonts it needs.
# Installing Chromium at build time on a generic Node image needs root for apt, which most managed
# platforms do not give you; this avoids the whole problem.
FROM mcr.microsoft.com/playwright:v1.63.0-noble AS base

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable

WORKDIR /app

# ── Dependencies ────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ── Build ───────────────────────────────────────────────────────────────────
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The build only needs the schema to be reachable, never a live database.
ENV NODE_ENV=production \
    DATABASE_URL=postgres://build:build@localhost:5432/build \
    AUTH_SECRET=build-time-placeholder-not-used-at-runtime
RUN pnpm build

# ── Runtime ─────────────────────────────────────────────────────────────────
FROM base AS runtime
# PLAYWRIGHT_CHROMIUM_EXECUTABLE is deliberately not set: this image ships the browsers that this
# exact Playwright version expects, and letting Playwright resolve its own avoids pinning a path
# that changes with every browser build.
ENV NODE_ENV=production \
    PORT=3000

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY package.json pnpm-lock.yaml next.config.ts ./
COPY drizzle ./drizzle
COPY src ./src
COPY seed ./seed
COPY scripts ./scripts
COPY tsconfig.json ./

EXPOSE 3000
CMD ["pnpm", "start"]
