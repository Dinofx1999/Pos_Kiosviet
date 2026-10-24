FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@10.34.8 --activate
WORKDIR /repo
COPY pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile=false --filter @erp/web...
COPY packages/shared packages/shared
COPY apps/web apps/web
ARG VITE_API_URL=/api/v1
ENV VITE_API_URL=$VITE_API_URL
WORKDIR /repo/apps/web
RUN pnpm build
FROM nginx:1.27-alpine
COPY docker/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
