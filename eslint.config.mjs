import nextConfig from "eslint-config-next";

const config = [
  ...nextConfig,
  {
    ignores: ["node_modules/**", ".next/**", "prisma/dev.db"],
  },
  {
    rules: {
      // Le contenu généré (marketing, avis, assistant) contient légitimement
      // des apostrophes françaises non échappées dans du JSX texte brut.
      "react/no-unescaped-entities": "off",
      // Les pages sont des Server Components Next.js exécutés une fois par
      // requête (pas des composants concurrents re-rendus) : calculer une
      // fenêtre temporelle avec `Date.now()` (ex. "30 derniers jours") y est
      // légitime et ne casse aucune garantie de pureté réelle ici.
      "react-hooks/purity": "off",
    },
  },
];

export default config;
