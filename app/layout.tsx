import type { Metadata, Viewport } from "next";
import "./globals.css";

// Aucune webfont : la pile "system-ui" (voir --font-sans dans globals.css)
// est déjà installée sur l'appareil, se charge instantanément et fonctionne
// hors ligne dès le premier rendu — pas de requête réseau, pas de flash de
// texte invisible/substitué à gérer.
export const metadata: Metadata = {
  title: "SQP Inventaire",
  description: "Outil d'inventaire de terrain pour SQP Impression UV.",
  icons: [
    { rel: "icon", url: "/icons/icon-192.svg" },
    { rel: "apple-touch-icon", url: "/icons/icon-192.svg" },
  ],
};

export const viewport: Viewport = {
  themeColor: "#14181f",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" className="h-full antialiased">
      <head>
        <link rel="manifest" href="/manifest.webmanifest" />
      </head>
      <body className="flex min-h-full flex-col bg-paper text-ink">{children}</body>
    </html>
  );
}
