FROM node:24-slim AS base
RUN corepack enable
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"

FROM base AS build
WORKDIR /repo
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @collaby/web...

ARG NEXT_PUBLIC_API_URL=""
ARG NEXT_PUBLIC_COLLAB_URL=""
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_COLLAB_URL=$NEXT_PUBLIC_COLLAB_URL
ENV NEXT_TELEMETRY_DISABLED=1

RUN pnpm --filter @collaby/web build

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/web/server.js"]
