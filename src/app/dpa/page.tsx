import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Accord de traitement des données (DPA) — OnDeal Intelligence",
  description: "Accord de traitement des données personnelles (Data Processing Agreement) d'OnDeal Intelligence.",
  robots: { index: true, follow: true },
};

const LAST_UPDATED = "5 septembre 2026";

/**
 * DPA — nouvelle page (audit conformité 05/09/2026). Décrit, en langage
 * accessible, la répartition des rôles RGPD (responsable de traitement =
 * le marchand utilisateur pour les données de ses clients ; OnDeal
 * Intelligence = sous-traitant au sens de l'article 28 RGPD pour ce même
 * traitement) et renvoie vers /sous-traitants pour le détail des
 * sous-traitants ultérieurs. Ce n'est pas un contrat DPA signé
 * individuellement — recommandé de faire établir, avec un avocat, un DPA
 * contractuel formel pour les clients qui le demandent (notamment
 * plans BUSINESS/AGENCY à usage professionnel plus intensif).
 */
export default function DpaPage() {
  return (
    <div className="legal-page">
      <div className="legal-page-inner">
        <p className="legal-kicker">OnDeal Intelligence</p>
        <h1>Accord de traitement des données (DPA)</h1>
        <p className="legal-updated">Dernière mise à jour : {LAST_UPDATED}</p>

        <div className="callout callout-warning" style={{ marginBottom: 24 }}>
          Ce document présente, à titre informatif, le fonctionnement réel du traitement des données. Il ne remplace
          pas un contrat de sous-traitance signé individuellement (article 28 du RGPD) ; les clients qui en ont besoin
          pour leurs propres obligations de conformité peuvent en demander un à{" "}
          <a href="mailto:contact@ondeal.fr">contact@ondeal.fr</a>. Ce point est recommandé pour validation par un
          avocat avant toute signature.
        </div>

        <h2>1. Répartition des rôles</h2>
        <p>
          Lorsque vous connectez votre boutique (Shopify, WooCommerce, PrestaShop) à OnDeal Intelligence, vous restez
          <strong> responsable de traitement</strong> au sens du RGPD pour les données de vos clients finaux
          (commandes, avis, contacts) que l&apos;application synchronise pour vous fournir ses analyses. OnDeal
          Intelligence agit alors en tant que <strong>sous-traitant</strong> (article 28 RGPD) pour ce traitement
          précis : il traite ces données pour votre compte et selon vos instructions (connexion et paramétrage de
          votre boutique), pas pour ses propres finalités commerciales.
        </p>
        <p>
          Pour vos propres données de compte (nom, e-mail, mot de passe), OnDeal Intelligence est
          <strong> responsable de traitement</strong> — voir la <a href="/privacy">politique de confidentialité</a>.
        </p>

        <h2>2. Nature et finalité du traitement</h2>
        <p>
          Les données de votre boutique (produits, variantes, stock, commandes, avis clients) sont synchronisées
          depuis votre plateforme e-commerce pour calculer des indicateurs, scores, alertes et recommandations, et
          pour permettre, sur votre validation explicite, certaines actions sur votre boutique (changement de prix, de
          stock, publication/dépublication).
        </p>

        <h2>3. Sous-traitants ultérieurs</h2>
        <p>
          OnDeal Intelligence fait appel à des prestataires techniques (hébergement, base de données, paiement,
          intelligence artificielle) pour fournir le service. La liste complète, avec finalité, catégorie de données
          et localisation de chacun, est détaillée sur la page dédiée : <a href="/sous-traitants">Sous-traitants</a>.
        </p>

        <h2>4. Sécurité</h2>
        <p>
          Les mesures de sécurité techniques mises en œuvre (chiffrement, hachage des mots de passe, vérification des
          webhooks) sont décrites sur la page <a href="/securite">Sécurité</a>.
        </p>

        <h2>5. Durée de conservation</h2>
        <p>
          Les données synchronisées depuis votre boutique sont conservées pendant la durée d&apos;utilisation du
          service, et supprimées ou anonymisées dans un délai raisonnable après désinstallation de l&apos;intégration
          ou suppression du compte, sur demande à{" "}
          <a href="mailto:contact@ondeal.fr">contact@ondeal.fr</a>.
        </p>

        <h2>6. Contact</h2>
        <p>
          Pour toute question relative au traitement des données ou pour demander un DPA contractuel signé :{" "}
          <a href="mailto:contact@ondeal.fr">contact@ondeal.fr</a>.
        </p>
      </div>
    </div>
  );
}
