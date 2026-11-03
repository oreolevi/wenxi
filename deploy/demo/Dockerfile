FROM node:24-bookworm-slim
WORKDIR /app
COPY --chown=node:node public/index.html ./public/index.html
COPY --chown=node:node server.mjs ./server.mjs
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
