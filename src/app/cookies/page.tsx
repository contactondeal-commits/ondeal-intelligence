import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Politique cookies — OnDeal Intelligence",
  description: "Politique relative aux cookies et technologies similaires d'OnDeal Intelligence.",
  robots: { index: true, follow: true },
};

const LAST_UPDATED = "5 septembre 2026";

/**
 * Cookies — nouvelle page (audit conformité 05/09/2026). Rédigée pour
 * refléter honnêtement l'état réel constaté dans le code : un unique cookie
 * de session strictement nécessaire (ondeal_session), aucun cookie
 * publicitaire ni traceur analytique tiers identifié à la date de
 * rédaction. Si un outil d'analytics/marketing est ajouté plus tard, cette
 * page ET un bandeau de consentement devront être mis à jour avant sa mise
 * en production — voir le rappel dans le callout ci-dessous.
 */
export default function CookiesPage() {
  return (
    <div className="legal-page">
      <div className="legal-page-inner">
        <p className="legal-kicker">OnDeal Intelligence</p>
        <h1>Politique cookies</h1>
        <p className="legal-updated">Dernière mise à jour : {LAST_UPDATED}</p>

        <div className="callout callout-warning" style={{ marginBottom: 24 }}>
          Ce document décrit l&apos;état réel du service à la date de mise à jour ci-dessus. Si un cookie de mesure
          d&apos;audience, publicitaire ou de personnalisation est ajouté par la suite, un bandeau de consentement
          conforme (CNIL) devra être mis en place avant sa mise en production, et cette page devra être mise à jour en
          conséquence — recommandé de valider ce point avec un professionnel du droit au moment de l&apos;ajout.
        </div>

        <h2>1. Ce que nous utilisons aujourd&apos;hui</h2>
        <p>
          OnDeal Intelligence utilise un seul cookie, strictement nécessaire au fonctionnement du service :
        </p>
        <table className="table" style={{ width: "100%", marginTop: 12, marginBottom: 12 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Cookie</th>
              <th style={{ textAlign: "left" }}>Finalité</th>
              <th style={{ textAlign: "left" }}>Durée</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>ondeal_session</td>
              <td>Maintenir la session de connexion de l&apos;utilisateur authentifié (indispensable pour accéder à
                l&apos;application).</td>
              <td>Session / expiration technique du jeton</td>
            </tr>
          </tbody>
        </table>
        <p>
          Ce cookie relève de l&apos;exemption de consentement prévue pour les cookies strictement nécessaires à la
          fourniture d&apos;un service expressément demandé par l&apos;utilisateur (article 82 de la loi Informatique
          et Libertés, lignes directrices CNIL) : aucun bandeau de consentement n&apos;est donc affiché pour ce
          cookie.
        </p>

        <h2>2. Ce que nous n&apos;utilisons pas</h2>
        <p>
          À la date de mise à jour de ce document, OnDeal Intelligence ne dépose aucun cookie publicitaire, aucun
          cookie de mesure d&apos;audience tiers (Google Analytics ou équivalent) et aucun traceur de réseau social sur
          l&apos;application intelligence.ondeal.fr.
        </p>

        <h2>3. Gestion par votre navigateur</h2>
        <p>
          Le cookie de session étant indispensable, le désactiver dans votre navigateur empêchera la connexion à
          l&apos;application. Vous pouvez à tout moment consulter et supprimer les cookies stockés via les paramètres
          de votre navigateur.
        </p>

        <h2>4. Contact</h2>
        <p>
          Pour toute question relative à cette politique : <a href="mailto:contact@ondeal.fr">contact@ondeal.fr</a>.
        </p>
      </div>
    </div>
  );
}
