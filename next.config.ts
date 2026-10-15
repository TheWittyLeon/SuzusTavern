import type { NextConfig } from "next";

/**
 * Comma-separated host list -> trimmed, non-empty entries.
 *
 * Next matches these against the request's HOSTNAME only (Next 16.2.6 isCsrfOriginAllowed), so an
 * entry with a scheme or path ("http://10.0.0.5:13000") would silently never match and the dev page
 * would hang on "Loading..."; that is a loud startup error here instead. A bare "*" is NOT rejected:
 * Next itself refuses to let a lone wildcard match anything (only "*.suffix" patterns match), so it
 * is inert, not an open door. Pinned against Next's own matcher in next-config.test.ts.
 */
export function parseOrigins(raw: string | undefined): string[] {
  const hosts = (raw ?? '').split(',').map((h) => h.trim()).filter(Boolean);
  const bad = hosts.find((h) => /[/:]/.test(h));
  if (bad) {
    throw new Error(
      `ALLOWED_DEV_ORIGINS entry "${bad}" must be a bare hostname or IP (no scheme, port or path).`,
    );
  }
  return hosts;
}

const nextConfig: NextConfig = {
  // UIR2-TAV-10: the review-queue UI lives at /admin/content; /admin/review
  // was a bare 404 (stale link/bookmark surface — no in-repo <Link> pointed
  // at it at the time of this fix, see not-found.tsx's own comment). A real
  // redirect (not just a nicer 404) means any stale external link, bookmark,
  // or future typo still lands the admin on the right page. 307 (temporary)
  // rather than 308 — this is a UI reroute, not a permanent URL change we
  // want search engines/clients to cache forever.
  // DEV-ONLY, and it is what makes the dev Tavern browser-testable at all.
  // The dev stack is served from another host (e.g. <dev-host>:13000), and
  // Next 16 blocks dev-time client assets/HMR for a cross-origin dev request
  // unless that origin is listed here — it prints this exact suggestion in
  // the container log. Without it the shell renders (SSR) but the React
  // client never executes, so every page sits on "Loading…" forever and
  // fires zero API calls. That looked like an app bug and was in fact an
  // unconfigured dev server; it also meant no UI change on that box could be
  // verified in a real browser.
  //
  // Ignored entirely by `next build` / production — this cannot affect the
  // deployed container's behaviour.
  // The origins come from ALLOWED_DEV_ORIGINS (comma-separated hosts), set by
  // the dev profile (NekoNova deployment/staging/docker-compose.tavern-dev.yml); unset = none listed, so a
  // second dev host needs a new env value, not a code edit.
  allowedDevOrigins: parseOrigins(process.env.ALLOWED_DEV_ORIGINS),
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
