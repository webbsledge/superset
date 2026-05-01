# Stage 1: Install superset-frontend dependencies
FROM node:20-alpine AS deps
WORKDIR /app

# Copy full superset-frontend tree so workspace dependency resolution stays consistent
COPY superset-frontend/ ./superset-frontend/

WORKDIR /app/superset-frontend
RUN npm ci --ignore-scripts

# Stage 2: Build the webpack bundle
FROM node:20-alpine AS builder
WORKDIR /app

# Copy installed node_modules from deps stage
COPY --from=deps /app/superset-frontend/node_modules ./superset-frontend/node_modules

# Copy superset-frontend source
COPY superset-frontend/ ./superset-frontend/

# Copy sidecar source and config
COPY query-context-sidecar/package.json query-context-sidecar/package-lock.json* ./query-context-sidecar/
COPY query-context-sidecar/webpack.config.js query-context-sidecar/tsconfig.json ./query-context-sidecar/
COPY query-context-sidecar/src/ ./query-context-sidecar/src/

WORKDIR /app/query-context-sidecar
RUN npm ci
RUN npm run build

# Stage 3: Minimal runtime
FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder /app/query-context-sidecar/dist ./dist

USER node
CMD ["node", "dist/index.js"]
