FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.34.8 --activate
WORKDIR /repo
COPY pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile=false --filter @erp/api... 
COPY packages/shared packages/shared
COPY apps/api apps/api
WORKDIR /repo/apps/api
RUN pnpm prisma generate && pnpm build
EXPOSE 3000
CMD ["node", "dist/src/main.js"]
