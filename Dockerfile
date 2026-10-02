FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 EDGELOG_DATA_DIR=/data
COPY --from=build /app/package.json /app/pnpm-lock.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/.openai ./.openai
COPY --from=build /app/vite.config.ts /app/worker ./
VOLUME ["/data"]
EXPOSE 3000
CMD ["node_modules/.bin/vinext", "start", "--hostname", "0.0.0.0", "--port", "3000"]
