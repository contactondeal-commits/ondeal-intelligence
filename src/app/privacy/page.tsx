import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Politique de confidentialité — OnDeal Intelligence",
  description: "Comment OnDeal Intelligence collecte, utilise et protège les données de votre boutique Shopify.",
  robots: { index: true, follow: true },
};

const LAST_UPDATED = "5 septembre 2026";

/**
 * Politique de confidentialité de l'app Shopify OnDeal Intelligence — page
 * publique (aucune authentification requise), exigée par la revue Shopify
 * App Store (URL renseignée dans le Partner Dashboard). Contenu rédigé
 * exclusivement à partir du comportement réel du code (modèle de données,
 * webhooks de conformité, chiffrement) — jamais de promesse non vérifiée.
 */
export default function PrivacyPolicyPage() {
  return (
    <div className="legal-page">
      <div className="legal-page-inner">
        <p className="legal-kicker">OnDeal Intelligence</p>
        <h1>Politique de confidentialité</h1>
        <p className="legal-updated">Dernière mise à jour : {LAST_UPDATED}</p>

        <p>
          OnDeal Intelligence (« l&apos;app ») est une application Shopify qui aide les marchands à analyser leur
          boutique (stock, avis, prix, marge) et à décider des actions à prendre. Cette page explique quelles
          données l&apos;app traite, pourquoi, avec qui elles sont partagées, et vos droits.
        </p>

        <h2>1. Responsable du traitement</h2>
        <p>
          Monsieur Brou — OnDeal.fr, entrepreneur individuel (micro-entreprise), SIREN 994 594 059, SIRET (établissement
          principal) 994 594 059 00010, 231 rue Saint-Honoré, 75001 Paris, France (adresse de domiciliation). Contact :{" "}
          <a href="mailto:contact@ondeal.fr">contact@ondeal.fr</a>. Voir aussi les{" "}
          <a href="/mentions-legales">mentions légales</a> pour le détail de l&apos;identité de l&apos;éditeur.
        </p>

        <h2>2. À qui s&apos;adresse cette page</h2>
        <p>
          Cette politique concerne les <strong>marchands</strong> qui installent OnDeal Intelligence sur leur
          boutique Shopify, et par extension les membres de leur équipe qu&apos;ils invitent dans l&apos;app. Pour
          la politique de confidentialité du site de vente ondeal.fr (achats de produits), voir{" "}
          <a href="https://ondeal.fr/legal/confidentialite">ondeal.fr/legal/confidentialite</a>.
        </p>

        <h2>3. Données que nous collectons</h2>
        <p>
          <strong>Compte marchand</strong> — nom, adresse e-mail, mot de passe (jamais stocké en clair : haché avec
          bcrypt).
        </p>
        <p>
          <strong>Données de votre boutique Shopify</strong> — lors de l&apos;installation, vous autorisez l&apos;app
          à accéder, selon les autorisations (« scopes ») demandées : vos produits et variantes, vos niveaux de
          stock, et vos commandes. Ces données servent uniquement à calculer les scores, alertes et recommandations
          affichés dans l&apos;app.
        </p>
        <p>
          <strong>Avis produits</strong> — si vous connectez volontairement l&apos;intégration Judge.me, l&apos;app
          récupère vos avis clients existants pour les afficher et les analyser dans l&apos;app.
        </p>
        <p>
          <strong>Journal d&apos;activité (audit log)</strong> — les actions effectuées dans l&apos;app
          (synchronisations, requêtes à l&apos;assistant, actions confirmées, changements de paramètres) sont
          enregistrées pour votre propre historique, visible dans l&apos;app.
        </p>
        <p>
          <strong>Assistant OnDeal AI (optionnel)</strong> — si cette fonctionnalité est activée sur votre
          organisation, vos questions en langage naturel sont envoyées à l&apos;API d&apos;Anthropic (Claude) pour
          générer une réponse. Seules des données déjà calculées par l&apos;app (jamais un accès direct à votre
          base de données ni à votre boutique) sont transmises pour formuler la réponse. Si cette fonctionnalité
          n&apos;est pas configurée, l&apos;assistant répond uniquement à partir d&apos;un moteur de règles interne,
          sans appel à un service externe.
        </p>

        <h2>4. Ce que nous ne collectons pas</h2>
        <p>
          Le modèle de données d&apos;OnDeal Intelligence ne stocke <strong>aucune coordonnée de contact des
          clients finaux</strong> de votre boutique (ni e-mail, ni téléphone, ni adresse de livraison) : les
          commandes synchronisées ne conservent que des informations agrégées (référence, statut, montants, articles
          commandés) nécessaires au calcul des indicateurs de vente et de marge.
        </p>
        <p>
          Exception : lorsque vous connectez volontairement l&apos;intégration Judge.me (voir section 3), le nom
          affiché par l&apos;auteur d&apos;un avis client (« authorName »), tel que rendu public par ce client sur votre
          boutique, est synchronisé avec l&apos;avis afin de pouvoir l&apos;afficher dans l&apos;app. Il ne s&apos;agit
          que du nom déjà rendu public par le client via son avis, jamais de son e-mail ni d&apos;une autre coordonnée.
        </p>

        <h2>5. Pourquoi nous traitons ces données</h2>
        <p>
          Ces traitements sont nécessaires à l&apos;exécution du service que vous avez demandé en installant
          l&apos;app (exécution du contrat) : sans l&apos;accès à vos produits, votre stock et vos commandes,
          l&apos;app ne peut pas fonctionner. L&apos;assistant IA et l&apos;intégration Judge.me sont, eux,
          strictement optionnels et activés à votre initiative.
        </p>

        <h2>6. Avec qui vos données sont partagées</h2>
        <p>
          Vos données ne sont jamais vendues ni louées. Elles sont traitées par les sous-traitants suivants,
          strictement pour faire fonctionner l&apos;app — liste détaillée (finalité, données, localisation) sur la
          page dédiée <a href="/sous-traitants">Sous-traitants</a> :
        </p>
        <ul>
          <li><strong>Shopify International Limited / WooCommerce / PrestaShop</strong> — plateforme e-commerce, source des données de votre boutique, selon celle que vous utilisez.</li>
          <li><strong>Vercel Inc.</strong> (440 N Barranca Avenue #4133, Covina, CA 91723, États-Unis) — hébergement de l&apos;application.</li>
          <li><strong>Neon</strong> — hébergement de la base de données PostgreSQL de l&apos;app.</li>
          <li><strong>Stripe</strong> — uniquement si vous souscrivez un plan payant, pour le traitement du paiement de votre abonnement.</li>
          <li><strong>Judge.me</strong> — uniquement si vous connectez cette intégration, pour la récupération de vos avis produits.</li>
          <li><strong>CJdropshipping</strong> — uniquement si vous connectez cette intégration, pour la synchronisation du stock fournisseur.</li>
          <li><strong>Anthropic</strong> — uniquement si l&apos;assistant OnDeal AI est activé sur votre organisation, pour générer les réponses en langage naturel (seuls des faits déjà calculés et l&apos;intention détectée de la question sont transmis, jamais le texte brut ni de donnée personnelle de client final).</li>
        </ul>

        <h2>7. Sécurité</h2>
        <p>
          Les jetons d&apos;accès à votre boutique Shopify (et à Judge.me, le cas échéant) sont chiffrés
          (AES-256-GCM) avant d&apos;être stockés en base — jamais en clair. Chaque requête entrante de Shopify
          (installation, webhooks) est vérifiée par signature HMAC avant d&apos;être traitée. Les échanges avec
          l&apos;app se font exclusivement en HTTPS.
        </p>

        <h2>8. Durée de conservation</h2>
        <p>
          Vos données sont conservées tant que l&apos;app reste installée sur votre boutique. Si vous
          désinstallez l&apos;app, Shopify nous en informe immédiatement (le statut de la connexion est mis à
          jour, sans effacement) puis nous envoie, 48 heures plus tard, une confirmation de désinstallation qui
          déclenche l&apos;effacement définitif de toutes les données rattachées à votre boutique (produits,
          variantes, commandes, avis, scores, recommandations, actions, historique, intégrations). Votre compte
          utilisateur et votre organisation OnDeal ne sont pas supprimés automatiquement à ce moment (ils peuvent
          couvrir d&apos;autres boutiques) — vous pouvez en demander la suppression à tout moment (voir section 10).
        </p>

        <h2>9. Vos droits, et ceux de vos clients (RGPD)</h2>
        <p>
          Conformément aux exigences Shopify et au RGPD, l&apos;app répond automatiquement à deux types de demandes
          transmises par Shopify :
        </p>
        <ul>
          <li>
            <strong>Demande d&apos;accès aux données d&apos;un client</strong> (customers/data_request) — comme
            décrit en section 4, l&apos;app ne détient, au titre des commandes, aucune coordonnée de contact du client
            final ; seul le nom d&apos;auteur d&apos;un avis Judge.me, déjà public, peut exister le cas échéant. La
            demande est consignée et, s&apos;il existe une telle donnée rattachée au client visé, celle-ci est
            transmise ; à défaut, elle est confirmée sans donnée à transmettre.
          </li>
          <li>
            <strong>Demande d&apos;effacement des données d&apos;un client</strong> (customers/redact) — les
            commandes explicitement visées par la demande sont supprimées.
          </li>
        </ul>
        <p>
          En tant que marchand (ou membre de son équipe), vous disposez d&apos;un droit d&apos;accès, de
          rectification, d&apos;effacement, d&apos;opposition et de portabilité sur vos propres données de compte.
          Pour l&apos;exercer, écrivez à <a href="mailto:contact@ondeal.fr">contact@ondeal.fr</a>. Vous pouvez
          aussi introduire une réclamation auprès de la CNIL (<a href="https://www.cnil.fr" target="_blank" rel="noopener noreferrer">www.cnil.fr</a>).
        </p>

        <h2>10. Nous contacter</h2>
        <p>
          Pour toute question sur cette politique ou sur le traitement de vos données, écrivez à{" "}
          <a href="mailto:contact@ondeal.fr">contact@ondeal.fr</a>.
        </p>

        <h2>11. Modifications</h2>
        <p>
          Cette politique peut évoluer avec l&apos;app. Toute modification substantielle sera reflétée par la
          date de mise à jour en haut de cette page.
        </p>
      </div>
    </div>
  );
}
