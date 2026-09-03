import { requireStore } from "@/lib/store-context";
import { prisma } from "@/lib/db";
import AppShell from "@/components/AppShell";
import Link from "next/link";
import { PLAN_FEATURES } from "@/lib/plan-limits";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const store = await requireStore(await searchParams);
  const members = await prisma.membership.findMany({ where: { organizationId: store.organizationId }, include: { user: true } });

  return (
    <AppShell store={store} active="/settings">
      <h1 className="page-title">Paramètres</h1>

      <div className="card" style={{ marginBottom: 18 }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 10 }}>Organisation</h2>
        <p style={{ fontSize: 14 }}>{store.organizationName} — plan <strong>{store.plan}</strong></p>
        <p className="unavailable-note" style={{ marginTop: 6 }}>
          Fonctionnalités incluses : {PLAN_FEATURES[store.plan]?.join(", ")}
        </p>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 10 }}>Boutiques</h2>
        <table className="table">
          <thead><tr><th>Nom</th><th>Type</th></tr></thead>
          <tbody>
            {store.allStores.map((s) => (
              <tr key={s.id}><td>{s.name}</td><td>{s.isDemo ? "🧪 Démo" : "Réelle"}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 10 }}>Équipe</h2>
        <table className="table">
          <thead><tr><th>Nom</th><th>Email</th><th>Rôle</th></tr></thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}><td>{m.user.name}</td><td>{m.user.email}</td><td>{m.role}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <Link href={`/settings/integrations?store=${store.id}`} className="btn btn-primary">Gérer les intégrations →</Link>
    </AppShell>
  );
}
