"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Trash2 } from "lucide-react";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";

/**
 * RGPD libre-service (audit conformité 05/09/2026) — export (art. 15/20) et
 * suppression de compte (art. 17), depuis Paramètres > Confidentialité &
 * légal. Voir /api/account/export et /api/account/delete.
 */
export default function AccountDataActions() {
  const router = useRouter();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function onExport() {
    setExporting(true);
    setExportError(null);
    try {
      const res = await fetch("/api/account/export");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setExportError(data.error ?? "Échec de l'export.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "ondeal-export.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setExportError("Échec de l'export (réseau).");
    } finally {
      setExporting(false);
    }
  }

  async function onDelete(e: React.FormEvent) {
    e.preventDefault();
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password, confirmation }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setDeleteError(data.error ?? "Échec de la suppression.");
        return;
      }
      router.push("/login");
      router.refresh();
    } catch {
      setDeleteError("Échec de la suppression (réseau).");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="feature-chips" style={{ marginTop: 12 }}>
        <Button variant="secondary" icon={<Download size={14} />} onClick={onExport} loading={exporting}>
          {exporting ? "Export en cours…" : "Exporter mes données (JSON)"}
        </Button>
        <Button
          variant="danger"
          icon={<Trash2 size={14} />}
          onClick={() => {
            setDeleteError(null);
            setPassword("");
            setConfirmation("");
            setDeleteOpen(true);
          }}
        >
          Supprimer mon compte
        </Button>
      </div>
      {exportError && (
        <p className="callout callout-error" style={{ marginTop: 8 }}>
          {exportError}
        </p>
      )}

      <Modal open={deleteOpen} onClose={() => setDeleteOpen(false)} labelledBy="delete-account-title">
        <form onSubmit={onDelete}>
          <h2 id="delete-account-title" style={{ fontSize: 17, fontWeight: 800, marginBottom: 8 }}>
            Supprimer votre compte
          </h2>
          <p className="cell-sub" style={{ marginBottom: 14 }}>
            Action <strong>irréversible</strong>. Si vous êtes l&apos;unique membre d&apos;une organisation, toutes ses
            données (boutiques, intégrations, produits, commandes, historique) seront supprimées définitivement. Si
            d&apos;autres personnes en sont membres, vous quittez simplement l&apos;organisation — ses données sont
            conservées pour elles.
          </p>
          {deleteError && <div className="callout callout-error" style={{ marginBottom: 12 }}>{deleteError}</div>}
          <div className="field">
            <label>Mot de passe</label>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="field">
            <label>
              Tapez <strong>SUPPRIMER</strong> pour confirmer
            </label>
            <input
              className="input"
              required
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
            />
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
            <Button type="button" variant="secondary" onClick={() => setDeleteOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" variant="danger" loading={deleting} disabled={confirmation !== "SUPPRIMER"}>
              {deleting ? "Suppression…" : "Supprimer définitivement"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
