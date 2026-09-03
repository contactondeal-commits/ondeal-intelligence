import { requireStore } from "@/lib/store-context";
import { prisma } from "@/lib/db";
import AppShell from "@/components/AppShell";
import ActionRow from "@/components/ActionRow";

export default async function ActionsPage({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const store = await requireStore(await searchParams);

  const actions = await prisma.actionItem.findMany({
    where: { storeId: store.id },
    include: { recommendation: { include: { product: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const pending = actions.filter((a) => a.status === "PENDING_VALIDATION" || a.status === "CONFIRMED");
  const done = actions.filter((a) => a.status === "EXECUTED" || a.status === "FAILED" || a.status === "CANCELLED");

  return (
    <AppShell store={store} active="/actions">
      <div className="topbar">
        <div>
          <h1 className="page-title">Actions</h1>
          <p className="page-subtitle">
            Chaque action sensible (prix, stock, publication) exige une validation humaine explicite avant toute
            exécution.
          </p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>En attente</h2>
        {pending.length === 0 ? (
          <p className="unavailable-note">Aucune action en attente.</p>
        ) : (
          pending.map((a) => <ActionRow key={a.id} action={serialize(a)} />)
        )}
      </div>

      <div className="card">
        <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>Historique des actions</h2>
        {done.length === 0 ? (
          <p className="unavailable-note">Aucune action exécutée pour le moment.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Statut</th>
                <th>Résultat</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {done.map((a) => (
                <tr key={a.id}>
                  <td>{a.type}</td>
                  <td>
                    <span className={`badge ${a.status === "EXECUTED" ? "badge-suggestion" : "badge-urgent"}`}>{a.status}</span>
                  </td>
                  <td>{a.resultJson ? JSON.parse(a.resultJson).detail : "—"}</td>
                  <td>{a.executedAt?.toLocaleString("fr-FR") ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AppShell>
  );
}

function serialize(a: {
  id: string;
  type: string;
  sensitivity: string;
  status: string;
  payloadJson: string;
  recommendation: { title: string; reason: string; product: { title: string } | null } | null;
}) {
  return {
    id: a.id,
    type: a.type,
    sensitivity: a.sensitivity as "SENSITIVE" | "SAFE",
    status: a.status as "PENDING_VALIDATION" | "CONFIRMED",
    payload: JSON.parse(a.payloadJson) as Record<string, unknown>,
    title: a.recommendation?.title ?? a.type,
    reason: a.recommendation?.reason ?? "",
    productTitle: a.recommendation?.product?.title ?? null,
  };
}
