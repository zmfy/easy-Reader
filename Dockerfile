# Stage 1: Build frontend
FROM node:22-alpine AS frontend-builder
WORKDIR /app
COPY frontend/package*.json ./
RUN npm install --no-fund --no-audit
COPY frontend/ .
RUN npm run build

# Stage 2: Build backend + prune to production deps
FROM node:22-alpine AS backend-builder
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY backend/package*.json ./
RUN npm install --no-fund --no-audit
COPY backend/tsconfig.json .
COPY backend/src ./src
RUN npm run build && npm prune --omit=dev

# Stage 3: Runtime (no build tools needed)
FROM node:22-alpine
WORKDIR /app
COPY --from=backend-builder /app/node_modules ./node_modules
COPY --from=backend-builder /app/dist ./dist
COPY --from=frontend-builder /app/dist ./public
EXPOSE 3000
CMD ["node", "dist/index.js"]
