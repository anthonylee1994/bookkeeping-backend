# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS base
RUN npm install -g pnpm@12.3.4
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN pnpm build

FROM base AS runtime
ENV NODE_ENV=production \
    TZ=Asia/Hong_Kong \
    DATABASE_URL=file:../storage/production.sqlite3
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY swagger ./swagger
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh && mkdir -p /app/storage
EXPOSE 3000
CMD ["/app/docker-entrypoint.sh"]
