# Production image for acikofis.teserix.com (Dokploy). GitHub Pages keeps using .github/workflows/pages.yml.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# Optional build ARG: the commit hash for the version stamp in sw.js (e.g. 2.2.0-b70ab57-<time>).
#   docker build --build-arg GITHUB_SHA=$(git rev-parse HEAD) .   (Dokploy: Build Args -> GITHUB_SHA=<commit>)
# Not passed / empty -> the stamp uses 'dev' (.git is not in the image); the build does not fail.
ARG GITHUB_SHA=""
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
