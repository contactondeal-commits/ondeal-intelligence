import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OnDeal Intelligence",
  description: "Copilote e-commerce — dashboard, intelligence, recommandations et actions pour votre boutique.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
