FROM node:24-alpine AS base

# Install system dependencies
RUN apk add --no-cache libc6-compat

# Enable pnpm
RUN corepack enable

# ============================================================
# Stage 1: Install dependencies
# ============================================================
FROM base AS deps

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml* ./

# Install all dependencies (including dev)
RUN pnpm install --frozen-lockfile

# ============================================================
# Stage 2: Build application
# ============================================================
FROM base AS builder

WORKDIR /app

# Accept DATABASE_URL as build argument
ARG DATABASE_URL

# Set environment variable for build
ENV DATABASE_URL=${DATABASE_URL}

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy source code
COPY . .

# Build the application
RUN pnpm run build

# ============================================================
# Stage 3: Production image (minimal size)
# ============================================================
FROM base AS runner

WORKDIR /app

ENV NODE_ENV production
ENV PORT 4000

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 fastify

# Copy package files
COPY package.json pnpm-lock.yaml* ./

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod && \
    pnpm prune --prod

# Copy built application from builder
COPY --from=builder /app/dist ./dist

# Copy drizzle config and migrations (needed for db:migrate command)
COPY drizzle.config.ts ./
COPY src/db ./src/db

# Fix ownership
RUN chown -R fastify:nodejs /app

# Switch to non-root user
USER fastify

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:4000/health || exit 1

EXPOSE 4000

CMD ["node", "dist/server.js"]