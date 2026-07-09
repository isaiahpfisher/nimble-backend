FROM node:20-alpine

WORKDIR /usr/src/app

# Install dependencies first so this layer is cached
# unless package.json / lockfile actually change.
COPY package*.json ./
RUN npm ci

# Copy the rest of the app (owned by the non-root node user).
COPY --chown=node:node . .

USER node

EXPOSE 3200

CMD ["node", "server.js"]
