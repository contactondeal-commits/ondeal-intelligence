import type { NextConfig } from "next";

// Le lint est exécuté séparément via `npm run lint` (voir BUILD/CI) —
// Next.js 16 a retiré l'intégration ESLint intégrée de la config de build.
const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
