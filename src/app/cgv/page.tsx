import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Conditions Générales de Vente — OnDeal Intelligence",
  description: "Conditions générales de vente des plans payants d'OnDeal Intelligence.",
  robots: { index: true, follow: true },
};

const LAST_UPDATED = "5 septembre 2026";

/**
 * CGV — nouvelle page (audit conformité 05/09/2026). Couvre la vente des
 * plans payants (PRO, BUSINESS, AGENCY) facturés via Stripe. Le plan STARTER
 * est gratuit et n'entre pas dans le champ des CGV. Tarifs alignés sur
 * PLAN_PRICING (src/lib/integrations/stripe-billing.ts) au moment de la
 * rédaction — à vérifier/tenir à jour si les tarifs changent.
 */
export default function CgvPage() {
  return (
    <div className="legal-page">
      <div className="legal-page-inner">
        <p className="legal-kicker">OnDeal Intelligence</p>
        <h1>Conditions Générales de Vente (CGV)</h1>
        <p className="legal-updated">Dernière mise à jour : {LAST_UPDATED}</p>

        <div className="callout callout-warning" style={{ marginBottom: 24 }}>
          Ce document est un modèle rédigé à partir du fonctionnement réel de la facturation. Il est recommandé de le
          faire valider par un professionnel du droit et par un expert-comptable avant toute utilisation
          contentieuse, notamment sur le régime de TVA applicable.
        </div>

        <h2>1. Champ d&apos;application</h2>
        <p>
          Les présentes CGV s&apos;appliquent à la souscription des plans payants d&apos;OnDeal Intelligence (PRO,
          BUSINESS, AGENCY), édités par Monsieur Brou (voir <a href="/mentions-legales">mentions légales</a>). Le
          plan STARTER, gratuit, n&apos;est pas concerné. Les présentes CGV complètent les <a href="/cgu">CGU</a>,
          qui restent applicables pour l&apos;usage du service.
        </p>

        <h2>2. Description des plans et tarifs</h2>
        <p>
          Les plans payants proposés à la date de mise à jour de ce document sont : PRO (14,90 € HT/mois), BUSINESS
          (49,90 € HT/mois) et AGENCY (99 € HT/mois), par boutique connectée sauf mention contraire affichée dans
          l&apos;application. Le contenu exact de chaque plan (fonctionnalités incluses) est décrit dans
          l&apos;écran Facturation de l&apos;application (Paramètres → Facturation), qui prévaut en cas de divergence
          avec tout autre support commercial.
          <br />
          <strong>Régime de TVA</strong> : [à confirmer avec l&apos;expert-comptable — micro-entreprise, franchise en
          base de TVA possible selon le chiffre d&apos;affaires réalisé ; les tarifs ci-dessus sont donc affichés hors
          taxes dans l&apos;attente de cette confirmation].
        </p>

        <h2>3. Souscription et paiement</h2>
        <p>
          La souscription à un plan payant s&apos;effectue depuis l&apos;application, par carte bancaire, via le
          prestataire de paiement Stripe. Stripe traite directement les données de carte bancaire ; OnDeal
          Intelligence n&apos;y a jamais accès. Le paiement est récurrent (mensuel), prélevé automatiquement à
          échéance jusqu&apos;à résiliation.
        </p>

        <h2>4. Durée et renouvellement</h2>
        <p>
          L&apos;abonnement est conclu pour une durée d&apos;un mois, renouvelée automatiquement par tacite
          reconduction, sauf résiliation par le client avant l&apos;échéance suivante.
        </p>

        <h2>5. Résiliation et effets</h2>
        <p>
          Le client peut résilier à tout moment depuis l&apos;application (Paramètres → Facturation) ou en écrivant à{" "}
          <a href="mailto:contact@ondeal.fr">contact@ondeal.fr</a>. La résiliation prend effet à la fin de la période
          déjà payée ; aucun remboursement au prorata n&apos;est effectué pour la période en cours, sauf disposition
          légale contraire. À l&apos;issue de cette période, le compte repasse automatiquement au plan gratuit
          STARTER et les fonctionnalités réservées aux plans payants deviennent indisponibles, sans perte des données
          déjà collectées.
        </p>

        <h2>6. Droit de rétractation</h2>
        <p>
          Conformément à l&apos;article L221-28 du Code de la consommation, le droit de rétractation ne s&apos;applique
          pas pleinement aux contrats de fourniture de services pleinement exécutés avant la fin du délai de
          rétractation avec l&apos;accord du consommateur. Pour un client agissant en tant que consommateur (hors
          usage professionnel), le client reconnaît, en activant un plan payant, demander l&apos;exécution immédiate du
          service et renoncer à son droit de rétractation dans cette mesure. Ce point relève d&apos;une qualification
          juridique à faire valider par un professionnel du droit selon le profil réel des clients (professionnels vs
          consommateurs).
        </p>

        <h2>7. Absence de facturation via Shopify</h2>
        <p>
          OnDeal Intelligence ne propose pas, à la date de mise à jour de ce document, de facturation intégrée via
          Shopify (Shopify Billing) : seul le paiement par carte via Stripe est disponible pour les plans payants.
        </p>

        <h2>8. Réclamations</h2>
        <p>
          Toute question relative à une facture ou à un paiement peut être adressée à{" "}
          <a href="mailto:contact@ondeal.fr">contact@ondeal.fr</a>.
        </p>

        <h2>9. Droit applicable</h2>
        <p>Les présentes CGV sont soumises au droit français.</p>
      </div>
    </div>
  );
}
