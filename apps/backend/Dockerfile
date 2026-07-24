# apps/backend/Dockerfile
#
# Build from the REPO ROOT, not this directory, because this is an npm-workspaces
# monorepo and the backend depends on the root package-lock.json and the root
# prisma/schema.prisma:
#
#   docker build -f apps/backend/Dockerfile -t petrol-pump-backend .
#   docker run --env-file .env -p 3000:3000 petrol-pump-backend
#
# Postgres is Supabase-hosted (see CLAUDE.md) — this image is the API process
# only, it does not run or bundle a database.

# ---------------------------------------------------------------------------
# Stage 1: workspace install + build
#   Full npm-workspaces install (all four apps) so `npm ci` matches the root
#   lockfile, then generate the Prisma client and compile just the backend.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# Prisma's query engine needs libssl on Alpine.
RUN apk add --no-cache openssl

# Copy only manifests first so this layer is cache-friendly across builds
# that don't change dependencies.
COPY package.json package-lock.json ./
COPY apps/backend/package.json ./apps/backend/package.json
COPY apps/web-portal/package.json ./apps/web-portal/package.json
COPY apps/dsm-app/package.json ./apps/dsm-app/package.json
COPY apps/customer-app/package.json ./apps/customer-app/package.json
COPY prisma ./prisma

RUN npm ci

# Now bring in backend source and build.
COPY apps/backend ./apps/backend

RUN npx prisma generate --schema=prisma/schema.prisma
RUN npm run build --workspace=apps/backend

# ---------------------------------------------------------------------------
# Stage 2: lean production dependencies
#   Installed standalone from just apps/backend/package.json — not workspace-
#   aware — so the runtime image doesn't drag in React/Expo/Vite deps that
#   only the other three workspaces need.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS prod-deps
WORKDIR /app

RUN apk add --no-cache openssl

COPY apps/backend/package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# ---------------------------------------------------------------------------
# Stage 3: runtime
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache openssl \
  && addgroup -S appgroup \
  && adduser -S appuser -G appgroup

ENV NODE_ENV=production
ENV API_PORT=3000

# Lean prod node_modules from stage 2 ...
COPY --from=prod-deps /app/node_modules ./node_modules
# ... overlaid with the real generated Prisma client from stage 1 (the plain
# `npm install` in stage 2 only pulls the @prisma/client package shell; the
# actual generated client + query engine binary come from `prisma generate`
# in the build stage, built on the same Alpine/musl target as this image).
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma/client ./node_modules/@prisma/client

COPY --from=build /app/apps/backend/dist ./dist
COPY --from=build /app/apps/backend/package.json ./package.json

USER appuser

EXPOSE 3000

CMD ["node", "dist/main.js"]
