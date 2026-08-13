FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime

# Stamped at build time so the running container can be tied back to an exact
# commit instead of being trusted because of its image tag.
ARG GIT_COMMIT=unknown
LABEL org.opencontainers.image.revision=$GIT_COMMIT
LABEL org.opencontainers.image.source=https://github.com/Bcousino890/zinto-app
LABEL org.opencontainers.image.title=zinto-integration-api

ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
RUN printf '%s\n' "$GIT_COMMIT" > /app/RELEASE

USER node
EXPOSE 3100
CMD ["node", "dist/src/server.js"]

