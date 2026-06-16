import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server build (.next/standalone/server.js) for a lean Node
  // container. Required because the Tavern runs a Node server — it has
  // server-side API routes (the /api/dnd proxy, /api/auth BFF, /api/narration
  // proxy), middleware (proxy.ts), and SSR — so it cannot be a static export
  // served by nginx like the NekoNova dashboard.
  output: "standalone",
};

export default nextConfig;
