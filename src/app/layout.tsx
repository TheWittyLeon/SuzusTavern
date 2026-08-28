import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import { getServerSession } from "@/lib/auth/session";
import ErrorBoundary from "@/components/ErrorBoundary";
import { ToastProvider } from "@/components/Toast";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { NO_FLASH_SCRIPT } from "@/lib/theme/theme";
import EnvBanner, { ENV_BANNER_HEIGHT_PX, ENV_BANNER_VISIBLE } from "@/components/EnvBanner";

// TAV-21: `--env-banner-h` is exposed on <html> (the CSS :root) so any
// full-height layout that needs the *actual* available viewport can do
// `height: calc(100dvh - var(--env-banner-h, 0px))` instead of a bare
// `100dvh` that ignores the in-flow banner above it. Computed here (not via
// a client effect in EnvBanner) because DEPLOY_ENV is a build-time constant
// known at render time — an SSR value avoids a post-hydration layout shift.
const envBannerHeightVar = ENV_BANNER_VISIBLE ? `${ENV_BANNER_HEIGHT_PX}px` : "0px";

export const metadata: Metadata = {
  title: "Aurora Tavern",
  description: "AI-DM driven 5e tabletop",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Hydrate the AuthProvider with the current user so first paint has auth state.
  // getServerSession reads st_access → calls AUTH_API_URL/auth/me directly
  // (server-to-server, no BFF round-trip).
  //
  // maybeAuthed: true when access expired but refresh cookie is present.
  // AuthProvider uses this to start in loading=true and silently refresh on
  // mount — preventing the logged-out flash for returning users (M2 fix).
  const { user: initialUser, maybeAuthed } = await getServerSession();

  return (
    // suppressHydrationWarning: the no-flash script (below) rewrites data-vibe/
    // data-density before hydration — from a saved palette, or (UIR2-TAV-4) from
    // the OS prefers-color-scheme when none is pinned; without this React would
    // warn about the attribute mismatch on any non-default resolved palette.
    <html
      lang="en"
      // T4p1: hearthlight-refined is now the app default (dusk-tavern stays
      // fully selectable via the TweaksPanel).
      data-vibe="hearthlight"
      data-density="cozy"
      suppressHydrationWarning
      style={{ '--env-banner-h': envBannerHeightVar } as React.CSSProperties}
    >
      <head>
        {/* Apply the saved palette/density before first paint — no theme flash. */}
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_SCRIPT }} />
      </head>
      <body>
        {/* Deployment environment banner — renders only on 'dev' / 'local'; null on 'prod'. */}
        <EnvBanner />
        {/* A11Y: first tab stop — jump past header/nav to the page's #main-content */}
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <ThemeProvider>
          <AuthProvider initialUser={initialUser} initialMaybeAuthed={maybeAuthed}>
            <ErrorBoundary>
              <ToastProvider>
                {children}
              </ToastProvider>
            </ErrorBoundary>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
