import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sous-traitants — OnDeal Intelligence",
  description: "Liste des sous-traitants et prestataires techniques d'OnDeal Intelligence.",
  robots: { index: true, follow: true },
};

const LAST_UPDATED = "5 septembre 2026";

type SubProcessor = {
  name: string;
  purpose: string;
  data: string;
  location: string;
};

/**
 * Sous-traitants — nouvelle page (audit conformité 05/09/2026). Liste
 * établie à partir des intégrations réellement présentes dans le code
 * (audit Section D). Anthropic n'est listé que si ANTHROPIC_API_KEY est
 * configuré (fonctionnalité optionnelle) — mentionné ici avec cette nuance
 * plutôt que présenté comme systématiquement actif.
 */
const SUBPROCESSORS: SubProcessor[] = [
  {
    name: "Vercel Inc.",
    purpose: "Hébergement de l'application web et exécution du code serveur.",
    data: "Toutes les données transitant par l'application (aucune donnée n'est stockée durablement par Vercel lui-même, hors logs techniques).",
    location: "États-Unis (infrastructure mondiale Vercel).",
  },
  {
    name: "Neon",
    purpose: "Hébergement de la base de données PostgreSQL (stockage durable de toutes les données de l'application).",
    data: "Comptes utilisateurs, organisations, boutiques, produits, commandes, avis clients, journaux d'audit.",
    location: "Union européenne ou États-Unis selon la région de la base de données configurée.",
  },
  {
    name: "Stripe",
    purpose: "Traitement des paiements des abonnements payants (PRO, BUSINESS, AGENCY).",
    data: "Informations de facturation et de paiement des utilisateurs souscrivant un plan payant. OnDeal Intelligence ne stocke jamais les numéros de carte bancaire.",
    location: "Irlande / États-Unis (Stripe, Inc. et Stripe Payments Europe, Ltd.).",
  },
  {
    name: "Shopify",
    purpose: "Synchronisation des données de la boutique connectée (produits, stock, commandes) et exécution, sur validation humaine, de certaines actions.",
    data: "Catalogue produits, stock, commandes, informations de boutique.",
    location: "Selon la configuration du marchand sur Shopify (généralement Union européenne ou Amérique du Nord).",
  },
  {
    name: "WooCommerce / PrestaShop",
    purpose: "Synchronisation des données de la boutique connectée pour les marchands utilisant ces plateformes.",
    data: "Catalogue produits, stock, commandes.",
    location: "Hébergement propre au marchand (WooCommerce/PrestaShop sont auto-hébergés).",
  },
  {
    name: "Judge.me",
    purpose: "Synchronisation des avis clients lorsque cette intégration est activée par le marchand.",
    data: "Avis clients, notes, et le cas échéant le nom affiché par l'auteur de l'avis.",
    location: "Selon la configuration Judge.me du marchand.",
  },
  {
    name: "CJdropshipping",
    purpose: "Synchronisation des niveaux de stock réel fournisseur lorsque cette intégration est activée par le marchand.",
    data: "Références produits et niveaux de stock fournisseur.",
    location: "Selon l'infrastructure de CJdropshipping.",
  },
  {
    name: "Anthropic (fonctionnalité optionnelle)",
    purpose: "Reformulation en langage naturel des réponses de l'assistant OnDeal AI, uniquement lorsque cette fonctionnalité est activée sur l'environnement.",
    data: "Uniquement des faits déjà calculés par l'application (indicateurs, chiffres) et l'intention détectée de la question posée — jamais le texte brut saisi par l'utilisateur, ni de donnée personnelle de client final.",
    location: "États-Unis (Anthropic, PBC).",
  },
];

export default function SousTraitantsPage() {
  return (
    <div className="legal-page">
      <div className="legal-page-inner">
        <p className="legal-kicker">OnDeal Intelligence</p>
        <h1>Sous-traitants</h1>
        <p className="legal-updated">Dernière mise à jour : {LAST_UPDATED}</p>

        <div className="callout callout-warning" style={{ marginBottom: 24 }}>
          Cette liste reflète les intégrations techniques réellement présentes dans l&apos;application à la date de
          mise à jour ci-dessus. Elle sera mise à jour si un nouveau prestataire est ajouté.
        </div>

        <p>
          Voir aussi l&apos;<a href="/dpa">accord de traitement des données (DPA)</a> pour la répartition des rôles
          RGPD entre vous et OnDeal Intelligence.
        </p>

        <div style={{ overflowX: "auto", marginTop: 16 }}>
          <table className="table" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Sous-traitant</th>
                <th style={{ textAlign: "left" }}>Finalité</th>
                <th style={{ textAlign: "left" }}>Données concernées</th>
                <th style={{ textAlign: "left" }}>Localisation</th>
              </tr>
            </thead>
            <tbody>
              {SUBPROCESSORS.map((s) => (
                <tr key={s.name}>
                  <td>{s.name}</td>
                  <td>{s.purpose}</td>
                  <td>{s.data}</td>
                  <td>{s.location}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h2 style={{ marginTop: 32 }}>Contact</h2>
        <p>
          Pour toute question relative à ces sous-traitants : <a href="mailto:contact@ondeal.fr">contact@ondeal.fr</a>.
        </p>
      </div>
    </div>
  );
}
