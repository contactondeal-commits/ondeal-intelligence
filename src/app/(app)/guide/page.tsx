import Link from "next/link";
import {
  BrainCircuit,
  Truck,
  Star,
  Coins,
  Megaphone,
  Bot,
  CheckSquare,
  History,
  Settings,
  ShieldCheck,
  AlertTriangle,
  TrendingUp,
  Sparkles,
} from "lucide-react";
import { requireStore } from "@/lib/store-context";
import { prisma } from "@/lib/db";
import AppShell from "@/components/AppShell";
import DataTag from "@/components/ui/DataTag";
import { PLAN_PRICING } from "@/lib/integrations/shopify-billing";

const MODULES: Array<{ icon: typeof BrainCircuit; title: string; href: string; text: string }> = [
  {
    icon: BrainCircuit,
    title: "Centre d'intelligence",
    href: "/intelligence",
    text: "Tous les signaux détectés sur votre boutique — Signaux (urgents), Opportunités — classés par priorité, avec la donnée réelle qui les justifie.",
  },
  {
    icon: Truck,
    title: "Stock",
    href: "/stock",
    text: "Ruptures et risques de rupture, calculés à partir des niveaux de stock réels synchronisés depuis Shopify.",
  },
  {
    icon: Star,
    title: "Avis",
    href: "/reviews",
    text: "Vos avis clients (Judge.me, une fois connecté) analysés pour repérer les produits qui méritent une attention particulière.",
  },
  {
    icon: Coins,
    title: "Prix & Marge",
    href: "/pricing",
    text: "Votre marge réelle produit par produit, et les opportunités de prix — nécessite vos coûts d'achat pour être fiable.",
  },
  {
    icon: Megaphone,
    title: "Marketing",
    href: "/marketing",
    text: "Génération de contenu marketing à partir des données réelles de vos produits.",
  },
  {
    icon: Bot,
    title: "OnDeal AI",
    href: "/assistant",
    text: "Posez une question en langage naturel sur votre boutique ; la réponse s'appuie sur ce qui est déjà calculé dans l'app, jamais sur une supposition.",
  },
  {
    icon: CheckSquare,
    title: "Actions",
    href: "/actions",
    text: "Les actions proposées par OnDeal, en attente de votre confirmation — rien n'est exécuté sans vous (voir ci-dessous).",
  },
  {
    icon: History,
    title: "Historique",
    href: "/audit-log",
    text: "Le journal complet de ce que l'app a fait, et pourquoi — synchronisations, actions confirmées, changements de paramètres.",
  },
  {
    icon: Settings,
    title: "Paramètres",
    href: "/settings",
    text: "Organisation, boutiques, intégrations (Shopify, Judge.me), équipe, et votre plan.",
  },
];

/**
 * GUIDE — page d'aide statique (04/09/2026), demandée pour que l'utilisateur
 * comprenne rapidement à quoi il a affaire : comment lire les données
 * (Réel/Calculé/Estimé/Indisponible), ce que fait chaque module, et le
 * principe de confirmation humaine avant toute action. Contenu strictement
 * descriptif de fonctionnalités réelles — aucune statistique inventée.
 */
export default async function GuidePage({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const params = await searchParams;
  const store = await requireStore(params);
  const org = await prisma.organization.findUnique({ where: { id: store.organizationId }, select: { plan: true } });

  return (
    <AppShell store={store} active="/guide">
      <div className="topbar">
        <div>
          <h1 className="page-title">Guide</h1>
          <p className="page-subtitle">Comprendre OnDeal Intelligence en quelques minutes — comment lire les données, et à quoi sert chaque module.</p>
        </div>
      </div>

      <section className="card cc-card" aria-labelledby="g-intro" style={{ marginBottom: 20 }}>
        <h2 id="g-intro" className="cc-card-title">
          <Sparkles size={15} aria-hidden="true" /> En une phrase
        </h2>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--color-text)" }}>
          OnDeal Intelligence lit les données réelles de votre boutique Shopify (produits, stock, commandes, avis) et
          les transforme en signaux clairs — jamais en actions automatiques : c&apos;est toujours vous qui décidez.
        </p>
      </section>

      <section className="card cc-card" aria-labelledby="g-tags" style={{ marginBottom: 20 }}>
        <h2 id="g-tags" className="cc-card-title">
          <ShieldCheck size={15} aria-hidden="true" /> Comment lire un chiffre
        </h2>
        <p className="cell-sub" style={{ marginBottom: 6 }}>
          Chaque donnée affichée dans l&apos;app porte une étiquette de fiabilité — jamais implicite.
        </p>
        <dl className="kv">
          <div>
            <dt><DataTag status="real" /></dt>
            <dd style={{ fontWeight: 500, fontSize: 13 }}>Lue telle quelle dans Shopify — pas de calcul.</dd>
          </div>
          <div>
            <dt><DataTag status="calculated" /></dt>
            <dd style={{ fontWeight: 500, fontSize: 13 }}>Dérivée par OnDeal à partir de données réelles (et d&apos;hypothèses si indiqué).</dd>
          </div>
          <div>
            <dt><DataTag status="estimated" /></dt>
            <dd style={{ fontWeight: 500, fontSize: 13 }}>Une hypothèse que vous avez saisie — pas une donnée Shopify.</dd>
          </div>
          <div>
            <dt><DataTag status="unavailable" /></dt>
            <dd style={{ fontWeight: 500, fontSize: 13 }}>Ne peut pas être calculée honnêtement avec les données actuelles.</dd>
          </div>
        </dl>
      </section>

      <section className="card cc-card" aria-labelledby="g-decision" style={{ marginBottom: 20 }}>
        <h2 id="g-decision" className="cc-card-title">
          <TrendingUp size={15} aria-hidden="true" /> Le principe de confirmation
        </h2>
        <p style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--color-text)" }}>
          OnDeal peut vous proposer une action (ex. ajuster un prix, relancer un fournisseur), mais ne l&apos;exécute
          jamais sur votre boutique tant que vous ne l&apos;avez pas explicitement confirmée dans <Link href={`/actions?store=${store.id}`} style={{ color: "var(--color-primary-dark)", fontWeight: 700 }}>Actions</Link>.
          Chaque étape est ensuite consignée dans l&apos;<Link href={`/audit-log?store=${store.id}`} style={{ color: "var(--color-primary-dark)", fontWeight: 700 }}>Historique</Link>.
        </p>
      </section>

      <section aria-labelledby="g-modules" style={{ marginBottom: 20 }}>
        <h2 id="g-modules" className="cc-card-title" style={{ marginBottom: 12 }}>
          <AlertTriangle size={15} aria-hidden="true" /> Les modules, en bref
        </h2>
        <div className="cc-row cc-row-2">
          {MODULES.map((m) => (
            <Link key={m.href} href={`${m.href}?store=${store.id}`} className="card cc-card" style={{ textDecoration: "none" }}>
              <div className="stat-tile-icon">
                <span className="stat-tile-glyph">
                  <m.icon size={16} aria-hidden="true" />
                </span>
                <div>
                  <h3 className="cc-card-title" style={{ marginBottom: 4 }}>{m.title}</h3>
                  <p className="cell-sub" style={{ fontSize: 12.5, lineHeight: 1.5 }}>{m.text}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="card cc-card" aria-labelledby="g-plan">
        <div className="cc-card-head">
          <h2 id="g-plan" className="cc-card-title">Votre plan</h2>
          <span className="badge badge-test">{org?.plan ?? store.plan}</span>
        </div>
        <p className="cell-sub" style={{ marginBottom: 10 }}>
          Starter est gratuit. Les plans supérieurs débloquent progressivement Prix &amp; Marge, Marketing, OnDeal AI,
          les automatisations, le multi-boutiques et l&apos;API.
        </p>
        <div className="rail-chips">
          <span className="rail-chip">STARTER — gratuit</span>
          <span className="rail-chip">PRO — {PLAN_PRICING.PRO.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} €/mois</span>
          <span className="rail-chip">BUSINESS — {PLAN_PRICING.BUSINESS.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} €/mois</span>
          <span className="rail-chip">AGENCY — {PLAN_PRICING.AGENCY.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} €/mois</span>
        </div>
        <Link href={`/settings?store=${store.id}`} className="btn btn-secondary btn-sm" style={{ alignSelf: "flex-start", marginTop: 14 }}>
          Voir les plans en détail
        </Link>
      </section>
    </AppShell>
  );
}
