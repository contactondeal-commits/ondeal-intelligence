import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Conditions Générales d'Utilisation — OnDeal Intelligence",
  description: "Conditions générales d'utilisation d'OnDeal Intelligence.",
  robots: { index: true, follow: true },
};

const LAST_UPDATED = "5 septembre 2026";

/**
 * CGU — nouvelle page (audit conformité 05/09/2026). Décrit les conditions
 * d'usage de l'application, distinctes des CGV (facturation) et de la
 * politique de confidentialité (données personnelles).
 */
export default function CguPage() {
  return (
    <div className="legal-page">
      <div className="legal-page-inner">
        <p className="legal-kicker">OnDeal Intelligence</p>
        <h1>Conditions Générales d&apos;Utilisation (CGU)</h1>
        <p className="legal-updated">Dernière mise à jour : {LAST_UPDATED}</p>

        <div className="callout callout-warning" style={{ marginBottom: 24 }}>
          Ce document est un modèle rédigé à partir du fonctionnement réel de l&apos;application. Il est recommandé
          de le faire valider par un professionnel du droit avant toute utilisation contentieuse.
        </div>

        <h2>1. Objet</h2>
        <p>
          Les présentes CGU régissent l&apos;accès et l&apos;utilisation d&apos;OnDeal Intelligence (« l&apos;app »),
          service en ligne édité par Monsieur Brou (entrepreneur individuel, SIREN 994 594 059, voir{" "}
          <a href="/mentions-legales">mentions légales</a>), accessible notamment via intelligence.ondeal.fr.
          L&apos;app permet aux marchands e-commerce de connecter leur boutique (Shopify, WooCommerce, PrestaShop et
          services associés) pour analyser leurs données, obtenir des scores, alertes, recommandations et
          exécuter, sur validation humaine explicite, certaines actions sur leur boutique.
        </p>

        <h2>2. Acceptation</h2>
        <p>
          La création d&apos;un compte et l&apos;utilisation de l&apos;app impliquent l&apos;acceptation pleine et
          entière des présentes CGU, de la <a href="/privacy">politique de confidentialité</a> et, pour les plans
          payants, des <a href="/cgv">CGV</a>.
        </p>

        <h2>3. Compte et accès</h2>
        <p>
          Chaque utilisateur est responsable de la confidentialité de ses identifiants et de l&apos;usage fait de
          son compte. Un compte est rattaché à une organisation ; les rôles (Propriétaire, Administrateur, Analyste,
          Lecteur) déterminent les actions autorisées au sein de l&apos;organisation.
        </p>

        <h2>4. Actions sur votre boutique</h2>
        <p>
          Certaines fonctionnalités (changement de prix, de stock, publication/dépublication d&apos;un produit) sont
          qualifiées de « sensibles » : elles ne sont jamais exécutées automatiquement par l&apos;app — une
          validation humaine explicite de l&apos;utilisateur est systématiquement requise avant toute modification
          réelle de la boutique connectée. L&apos;utilisateur reste seul responsable des décisions qu&apos;il valide.
        </p>

        <h2>5. Assistant IA (OnDeal AI)</h2>
        <p>
          Lorsque cette fonctionnalité optionnelle est activée, les réponses sont générées à partir de données déjà
          calculées par l&apos;app ; aucune donnée personnelle de client final n&apos;est sciemment transmise à ce
          service. Il est recommandé de ne pas saisir de donnée personnelle d&apos;un tiers dans les questions
          posées à l&apos;assistant.
        </p>

        <h2>6. Disponibilité</h2>
        <p>
          L&apos;app est fournie « en l&apos;état ». Aucune garantie de disponibilité continue n&apos;est apportée ;
          des interruptions liées à la maintenance, aux mises à jour ou aux services tiers (Shopify, Stripe,
          hébergeur) peuvent survenir.
        </p>

        <h2>7. Responsabilité</h2>
        <p>
          L&apos;app fournit des analyses, scores et recommandations à titre d&apos;aide à la décision. Elle ne se
          substitue pas au jugement commercial du marchand, qui reste seul responsable des décisions prises sur sa
          boutique, y compris celles exécutées via l&apos;app après sa validation explicite.
        </p>

        <h2>8. Résiliation</h2>
        <p>
          L&apos;utilisateur peut cesser d&apos;utiliser l&apos;app à tout moment (désinstallation de
          l&apos;intégration, suppression de compte sur demande à <a href="mailto:contact@ondeal.fr">contact@ondeal.fr</a>).
          L&apos;éditeur peut suspendre un compte en cas d&apos;usage abusif ou frauduleux.
        </p>

        <h2>9. Droit applicable</h2>
        <p>Les présentes CGU sont soumises au droit français.</p>

        <h2>10. Contact</h2>
        <p>
          <a href="mailto:contact@ondeal.fr">contact@ondeal.fr</a>
        </p>
      </div>
    </div>
  );
}
