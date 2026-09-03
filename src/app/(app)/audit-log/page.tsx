import { requireStore } from "@/lib/store-context";
import { prisma } from "@/lib/db";
import AppShell from "@/components/AppShell";

export default async function AuditLogPage({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const store = await requireStore(await searchParams);

  const logs = await prisma.auditLog.findMany({
    where: { storeId: store.id },
    include: { user: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <AppShell store={store} active="/audit-log">
      <h1 className="page-title">Historique</h1>
      <p className="page-subtitle" style={{ marginBottom: 18 }}>Journal d'activité complet — comprendre ce que l'application a fait, et pourquoi.</p>

      <div className="card">
        {logs.length === 0 ? (
          <p className="unavailable-note">Aucun événement enregistré pour le moment.</p>
        ) : (
          <table className="table">
            <thead><tr><th>Date</th><th>Acteur</th><th>Événement</th><th>Détail</th></tr></thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{l.createdAt.toLocaleString("fr-FR")}</td>
                  <td>{l.actorType === "system" ? "🤖 Système" : l.user?.name ?? "Utilisateur"}</td>
                  <td><span className="badge badge-neutral">{l.event}</span></td>
                  <td>{l.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AppShell>
  );
}
