FROM node:22-alpine AS dependencies
WORKDIR /app
# 国内服务器无法稳定访问 registry.npmjs.org：corepack 走 npmmirror，并预装固定版本 pnpm，
# 避免运行时联网拉取导致容器启动失败。
ENV COREPACK_NPM_REGISTRY=https://registry.npmmirror.com
RUN corepack enable && corepack prepare pnpm@11.16.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --registry=https://registry.npmmirror.com

FROM dependencies AS build
ARG NEXT_PUBLIC_API_BASE_URL=/api/v1
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
COPY . .
RUN pnpm build

FROM node:22-alpine AS runtime
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
ENV COREPACK_NPM_REGISTRY=https://registry.npmmirror.com
RUN corepack enable && corepack prepare pnpm@11.16.0 --activate
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json pnpm-workspace.yaml ./
# pnpm 在运行 script 前会校验依赖状态：当 package.json 的 mtime 晚于
# node_modules/.modules.yaml 时判定依赖过期并自动 install。node_modules 层
# 可能命中构建缓存（mtime 停留在旧构建时间），导致生产容器以只读 /app
# 启动时误触发 install 而 EACCES 崩溃。将对齐到 .modules.yaml 的 mtime。
RUN touch -r node_modules/.modules.yaml package.json pnpm-workspace.yaml
USER node
EXPOSE 3000
CMD ["pnpm", "start", "--hostname", "0.0.0.0", "--port", "3000"]
