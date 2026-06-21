import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import { getServerSession } from "@/lib/auth/session";
import ErrorBoundary from "@/components/ErrorBoundary";
import { ToastProvider } from "@/components/Toast";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { NO_FLASH_SCRIPT } from "@/lib/theme/theme";

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
    // data-density from localStorage before hydration; without this React would
    // warn about the attribute mismatch on a non-default saved palette.
    <html lang="en" data-vibe="dusk-tavern" data-density="cozy" suppressHydrationWarning>
      <head>
        {/* Apply the saved palette/density before first paint — no theme flash. */}
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_SCRIPT }} />
      </head>
      <body>
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
