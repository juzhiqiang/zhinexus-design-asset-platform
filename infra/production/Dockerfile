# Package only previously built service dependency closures, from a Linux CI staging directory.
# NODE_RUNTIME_IMAGE must be node:26.13.0-bookworm-slim@sha256:<reviewed digest>.
ARG NODE_RUNTIME_IMAGE
FROM ${NODE_RUNTIME_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
USER node
FROM runtime AS api
COPY --chown=node:node api/ /app/
CMD ["node", "dist/server.js"]
FROM runtime AS preview
COPY --chown=node:node preview/ /app/
CMD ["node", "dist/server.js"]
