import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // UIR2-TAV-10: the review-queue UI lives at /admin/content; /admin/review
  // was a bare 404 (stale link/bookmark surface — no in-repo <Link> pointed
  // at it at the time of this fix, see not-found.tsx's own comment). A real
  // redirect (not just a nicer 404) means any stale external link, bookmark,
  // or future typo still lands the admin on the right page. 307 (temporary)
  // rather than 308 — this is a UI reroute, not a permanent URL change we
  // want search engines/clients to cache forever.
  async redirects() {
    return [
      {
        source: '/admin/review',
        destination: '/admin/content',
        permanent: false,
      },
    ];
  },
  // Self-contained server build (.next/standalone/server.js) for a lean Node
  // container. Required because the Tavern runs a Node server — it has
  // server-side API routes (the /api/dnd proxy, /api/auth BFF, /api/narration
  // proxy), middleware (proxy.ts), and SSR — so it cannot be a static export
  // served by nginx like the NekoNova dashboard.
  output: "standalone",
  // UIR2-TAV-16: the dev-mode "N" build-activity indicator defaults to
  // bottom-left and stamps over real content in 390/640 viewport captures
  // (composer/footer controls live in that corner on several pages). It's
  // dev-only tooling — never present in `output: "standalone"` production
  // builds — and there's no single corner confirmed clear across every
  // route/viewport this repo audits, so disable it outright rather than
  // guess a "safer" corner without a live browser to re-verify against.
  devIndicators: false,
};

export default nextConfig;
