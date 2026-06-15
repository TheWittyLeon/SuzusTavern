import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import { getServerSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Suzu's Tavern",
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
  const { user: initialUser } = await getServerSession();

  return (
    <html lang="en" data-vibe="dusk-tavern">
      <body>
        <AuthProvider initialUser={initialUser}>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
