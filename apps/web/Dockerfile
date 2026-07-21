# Web app Dockerfile (for docker-compose local dev; Vercel builds directly).
FROM node:22-slim AS base
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

# Install workspace deps.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/web/package.json ./apps/web/package.json
RUN pnpm install --no-frozen-lockfile

# Build.
COPY apps/web ./apps/web
RUN pnpm --filter @handhistory/web run build

EXPOSE 3000
CMD ["pnpm", "--filter", "@handhistory/web", "start"]
