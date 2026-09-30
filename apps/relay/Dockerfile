# The Opencast relay service (docs/relay.md). One image for Railway and for any plain Linux server:
# everything it needs to know comes from the environment. Build from the repository root:
#
#   docker build -f apps/relay/Dockerfile -t opencast-relay .
#   docker run --env-file relay.env -p 8789:8789 opencast-relay
#
# FFmpeg does the pushing (stream-copied, or the bug composited); sharp draws the slates with the
# system's fonts.

FROM node:22-bookworm-slim AS build
# Native modules some dependencies build (ws's bufferutil) want a compiler.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
RUN npm ci --include=dev --no-audit --no-fund \
 && npx turbo run build --filter=@opencast/relay... \
 && npm prune --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg fontconfig fonts-dejavu-core ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    RELAY_SCRATCH_DIR=/tmp/opencast-relay \
    RELAY_PORT=8789
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/relay/package.json ./apps/relay/package.json
COPY --from=build /app/apps/relay/dist ./apps/relay/dist
RUN mkdir -p /tmp/opencast-relay && chown node:node /tmp/opencast-relay
USER node
EXPOSE 8789
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||process.env.RELAY_PORT||8789)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/relay/dist/relay.js"]
