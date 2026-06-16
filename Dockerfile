# syntax=docker/dockerfile:1
# Suzu's Tavern — Next.js Node-server container for the homelab.
#
# Unlike the NekoNova dashboard (static Vite build → nginx), the Tavern runs a
# Node server: it has server-side API routes (the /api/dnd proxy, the /api/auth
# cookie-BFF, the /api/narration proxy), Edge middleware (proxy.ts), and SSR.
# So it must execute server code, not be served as static files.
#
# Uses Next.js `output: "standalone"` → a minimal self-contained server bundle.

# ---- deps ----------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# ---- build ---------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# src/lib/env.ts validates these at build time (throws if missing in prod).
# Bake homelab defaults; override at runtime via compose `environment:`.
ARG NEXT_PUBLIC_NEKANOVA_URL=http://10.69.69.43:8080
ARG AUTH_API_URL=http://10.69.69.43:5555
ENV NEXT_PUBLIC_NEKANOVA_URL=$NEXT_PUBLIC_NEKANOVA_URL
ENV AUTH_API_URL=$AUTH_API_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- runner --------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Run as non-root.
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs
# Standalone server + the static/public assets it serves.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
