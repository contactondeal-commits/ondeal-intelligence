import Link from "next/link";

/**
 * Affiché lorsque le plan de l'organisation n'inclut pas le module demandé.
 * Contrôle SERVEUR (page + API), pas seulement masquage du menu.
 */
export default function FeatureUnavailable({ feature, plan, storeId }: { feature: string; plan: string; storeId: string }) {
  return (
    <section className="card cc-card" aria-labelledby="feature-unavailable">
      <h1 id="feature-unavailable" className="page-title">
        Module non inclus dans votre plan
      </h1>
      <p className="page-subtitle">
        Le module « {feature} » n&apos;est pas disponible avec le plan {plan}. Le changement de plan n&apos;est pas encore disponible depuis
        l&apos;application.
      </p>
      <Link href={`/dashboard?store=${storeId}`} className="btn btn-secondary" style={{ alignSelf: "flex-start" }}>
        Retour au Command Center
      </Link>
    </section>
  );
}
