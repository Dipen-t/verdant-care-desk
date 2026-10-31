FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY --from=build /app/server/schema.sql ./server/schema.sql
COPY --from=build /app/server/realtime.sql ./server/realtime.sql
COPY --from=build /app/certs ./certs
USER node
EXPOSE 3001
CMD ["node", "dist-server/index.js"]
