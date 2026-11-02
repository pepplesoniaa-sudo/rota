FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS builder
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .prettierrc .prettierignore eslint.config.mjs tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
COPY apps/mobile/package.json ./apps/mobile/package.json

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @rota/shared build || true
RUN pnpm --filter api exec prisma generate
RUN pnpm --filter api build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app/apps/api/public ./public
COPY --from=builder /app/apps/api/.next/standalone ./
COPY --from=builder /app/apps/api/.next/static ./.next/static
COPY --from=builder /app/apps/api/prisma ./prisma

EXPOSE 3000
CMD ["node", "server.js"]

