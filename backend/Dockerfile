FROM node:22-alpine AS dependencies
WORKDIR /app
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories
RUN apk add --no-cache python3 make g++
# 国内服务器无法稳定访问 registry.npmjs.org：固定 pnpm 版本并统一走 npmmirror，
# 避免镜像构建时由 Corepack 临时访问官方源。
ENV COREPACK_NPM_REGISTRY=https://registry.npmmirror.com
RUN corepack enable && corepack prepare pnpm@11.16.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --registry=https://registry.npmmirror.com

FROM dependencies AS build
COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build

FROM node:22-alpine AS runtime-base
WORKDIR /app
ARG EVDP_RELEASE_VERSION=dev
ARG EVDP_GIT_SHA=unknown
ARG EVDP_BUILD_TIME=unknown
ENV NODE_ENV=production
ENV EVDP_RELEASE_VERSION=${EVDP_RELEASE_VERSION}
ENV EVDP_GIT_SHA=${EVDP_GIT_SHA}
ENV EVDP_BUILD_TIME=${EVDP_BUILD_TIME}
LABEL org.opencontainers.image.version=${EVDP_RELEASE_VERSION}
LABEL org.opencontainers.image.revision=${EVDP_GIT_SHA}
LABEL org.opencontainers.image.created=${EVDP_BUILD_TIME}
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories
RUN apk add --no-cache libstdc++ && corepack enable
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

FROM runtime-base AS api
EXPOSE 4000
USER node
CMD ["sh", "-c", "node dist/database/run-migrations.js && node dist/cli/bootstrap-local-identity.js && node dist/main.js"]

FROM runtime-base AS media-worker
RUN apk add --no-cache ffmpeg
USER node
CMD ["node", "dist/media/media-worker.js"]

FROM runtime-base AS ai-quality-worker
RUN apk add --no-cache ffmpeg
USER node
CMD ["node", "dist/ai-quality/ai-quality-worker.js"]

FROM runtime-base AS ai-annotation-worker
RUN apk add --no-cache ffmpeg
USER node
CMD ["node", "dist/video-annotation/annotation-worker.js"]

FROM runtime-base AS ai-quality-lab
RUN apk add --no-cache ffmpeg su-exec
EXPOSE 4010
CMD ["sh", "-c", "mkdir -p /data/quality-lab && chown -R node:node /data/quality-lab && exec su-exec node node dist/quality-lab/main.js"]
