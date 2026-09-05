import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Mentions légales — OnDeal Intelligence",
  description: "Mentions légales de l'éditeur d'OnDeal Intelligence.",
  robots: { index: true, follow: true },
};

const LAST_UPDATED = "5 septembre 2026";

/**
 * Mentions légales — nouvelle page (audit conformité 05/09/2026). Rédigée à
 * partir des documents officiels fournis (Guichet Unique des Entreprises,
 * formalité Y00274281229 du 22/08/2026 ; attestation de domiciliation
 * KANDBAZ du 22/08/2026) — informations réelles, pas des placeholders,
 * sauf mention contraire explicite ci-dessous.
 */
export default function MentionsLegalesPage() {
  return (
    <div className="legal-page">
      <div className="legal-page-inner">
        <p className="legal-kicker">OnDeal Intelligence</p>
        <h1>Mentions légales</h1>
        <p className="legal-updated">Dernière mise à jour : {LAST_UPDATED}</p>

        <div className="callout callout-warning" style={{ marginBottom: 24 }}>
          Ce document est un modèle rédigé à partir des informations transmises par l&apos;éditeur. Il est recommandé
          de le faire valider par un professionnel du droit avant toute utilisation contentieuse.
        </div>

        <h2>1. Éditeur du site et de l&apos;application</h2>
        <p>
          <strong>Éditeur</strong> : Monsieur Brou, exerçant sous le nom commercial « OnDeal » / « OnDeal.fr »,
          entrepreneur individuel (micro-entreprise).
          <br />
          <strong>SIREN</strong> : 994 594 059 — <strong>SIRET (établissement principal)</strong> : 994 594 059 00010.
          <br />
          <strong>Code APE</strong> : 4791A (Vente à distance sur catalogue général).
          <br />
          <strong>Adresse du siège</strong> : 231 rue Saint-Honoré, 75001 Paris, France (adresse de domiciliation).
          <br />
          <strong>Régime de TVA</strong> : [à confirmer avec l&apos;expert-comptable — micro-entreprise, franchise en
          base de TVA possible selon le chiffre d&apos;affaires réalisé].
          <br />
          <strong>Contact</strong> : <a href="mailto:contact@ondeal.fr">contact@ondeal.fr</a>.
        </p>

        <h2>2. Domiciliation</h2>
        <p>
          L&apos;entreprise est domiciliée par KANDBAZ (SAS), 1 rue de Stockholm, 75008 Paris, RCS Paris 497 933 408,
          agrément préfectoral n° DOM2025097.
        </p>

        <h2>3. Directeur de la publication</h2>
        <p>Monsieur Brou, en qualité d&apos;entrepreneur individuel exploitant OnDeal.fr.</p>

        <h2>4. Hébergement</h2>
        <p>
          <strong>Application (intelligence.ondeal.fr)</strong> : Vercel Inc., 440 N Barranca Avenue #4133, Covina, CA
          91723, États-Unis.
          <br />
          <strong>Base de données</strong> : Neon (hébergement PostgreSQL).
        </p>

        <h2>5. Propriété intellectuelle</h2>
        <p>
          L&apos;ensemble des éléments (textes, logiciels, interfaces, marques citées) accessibles sur OnDeal
          Intelligence est protégé par le droit de la propriété intellectuelle. Toute reproduction non autorisée est
          interdite.
        </p>

        <h2>6. Contact</h2>
        <p>
          Pour toute question relative à ces mentions légales : <a href="mailto:contact@ondeal.fr">contact@ondeal.fr</a>.
        </p>

        <h2>7. Autres pages légales</h2>
        <p>
          <a href="/privacy">Politique de confidentialité</a> · <a href="/cgu">CGU</a> · <a href="/cgv">CGV</a> ·{" "}
          <a href="/cookies">Cookies</a> · <a href="/dpa">DPA</a> · <a href="/sous-traitants">Sous-traitants</a> ·{" "}
          <a href="/securite">Sécurité</a>
        </p>
      </div>
    </div>
  );
}
