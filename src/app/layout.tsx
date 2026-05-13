import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Suzu's Tavern",
  description: "AI-DM driven 5e tabletop",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-vibe="dusk-tavern">
      <body>{children}</body>
    </html>
  );
}
