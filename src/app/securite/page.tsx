import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sécurité — OnDeal Intelligence",
  description: "Mesures de sécurité techniques mises en œuvre par OnDeal Intelligence.",
  robots: { index: true, follow: true },
};

const LAST_UPDATED = "5 septembre 2026";

/**
 * Sécurité / Trust Center — nouvelle page (audit conformité 05/09/2026).
 * Uniquement des affirmations vérifiées dans le code (audit Section F) —
 * volontairement AUCUNE mention de certification (ISO 27001, SOC 2, etc.)
 * qui n'existe pas réellement, pour éviter toute allégation trompeuse.
 */
export default function SecuritePage() {
  return (
    <div className="legal-page">
      <div className="legal-page-inner">
        <p className="legal-kicker">OnDeal Intelligence</p>
        <h1>Sécurité</h1>
        <p className="legal-updated">Dernière mise à jour : {LAST_UPDATED}</p>

        <div className="callout callout-warning" style={{ marginBottom: 24 }}>
          Cette page décrit les mesures techniques réellement mises en œuvre à la date ci-dessus. OnDeal Intelligence
          ne détient, à ce jour, aucune certification de sécurité formelle (ISO 27001, SOC 2 ou équivalent) — cette
          page n&apos;en revendique aucune.
        </div>

        <h2>1. Chiffrement</h2>
        <p>
          Les secrets d&apos;intégration sensibles (jetons d&apos;accès aux boutiques connectées, clés API) sont
          chiffrés au repos avec l&apos;algorithme AES-256-GCM avant leur stockage en base de données.
        </p>

        <h2>2. Mots de passe</h2>
        <p>
          Les mots de passe des utilisateurs ne sont jamais stockés en clair : ils sont hachés avec l&apos;algorithme
          bcrypt avant tout enregistrement.
        </p>

        <h2>3. Vérification des webhooks</h2>
        <p>
          Les notifications entrantes provenant de Stripe et de Shopify (webhooks) sont systématiquement vérifiées
          par comparaison de signature HMAC en temps constant, afin de garantir leur authenticité avant tout
          traitement.
        </p>

        <h2>4. Contrôle d&apos;accès</h2>
        <p>
          L&apos;accès aux données d&apos;une boutique est strictement limité aux utilisateurs membres de
          l&apos;organisation propriétaire de cette boutique, avec des rôles (Propriétaire, Administrateur, Analyste,
          Lecteur) déterminant les actions autorisées. Chaque accès à une ressource est vérifié côté serveur.
        </p>

        <h2>5. Actions sensibles</h2>
        <p>
          Les actions pouvant modifier votre boutique (changement de prix, de stock, publication/dépublication d&apos;un
          produit) ne sont jamais exécutées automatiquement : elles nécessitent systématiquement une validation
          humaine explicite avant toute mutation réelle.
        </p>

        <h2>6. Journalisation</h2>
        <p>
          Les événements significatifs (synchronisations, actions exécutées, modifications de paramètres) sont
          journalisés dans un historique d&apos;audit consultable dans l&apos;application (plans BUSINESS et supérieur).
        </p>

        <h2>7. Signaler une vulnérabilité</h2>
        <p>
          Si vous identifiez une faille de sécurité, merci de la signaler de manière responsable à{" "}
          <a href="mailto:contact@ondeal.fr">contact@ondeal.fr</a> plutôt que de la divulguer publiquement, afin de
          nous laisser le temps de la corriger.
        </p>
      </div>
    </div>
  );
}
