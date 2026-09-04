"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, RefreshCw, Plug, LogOut, Bot, CornerDownLeft } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { NAV_ICONS } from "@/components/icons";

export interface CommandNavItem {
  href: string;
  label: string;
  group: string;
}

interface CommandEntry {
  key: string;
  label: string;
  group: string;
  icon: typeof Search;
  run: () => void;
}

/**
 * Command Bar globale (⌘K / Ctrl+K) — navigation, actions et point d'entrée
 * vers le Copilot en langage naturel. Ne fait AUCUN traitement NLP côté
 * client : une requête qui ne correspond à aucune page/action connue est
 * transmise telle quelle à l'Assistant IA existant (/api/assistant/query),
 * qui répond à partir des données réelles de la boutique.
 */
export default function CommandBar({
  navItems,
  storeId,
  canSync,
}: {
  navItems: CommandNavItem[];
  storeId: string;
  canSync: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isCombo = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      if (isCombo) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (open) {
      // Réinitialisation de l'état interne à chaque ouverture — pas une
      // synchronisation continue avec une source externe, donc une seule
      // écriture par ouverture (déclenchée par le changement de `open`).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuery("");
      setActiveIndex(0);
      // Le focus doit suivre l'ouverture — micro-délai pour laisser le modal se monter.
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  function close() {
    setOpen(false);
  }

  function go(href: string) {
    router.push(href.includes("?") ? `${href}&store=${storeId}` : `${href}?store=${storeId}`);
    close();
  }

  async function runSync() {
    setSyncing(true);
    await fetch("/api/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ storeId }) });
    setSyncing(false);
    router.refresh();
    close();
  }

  const actions: CommandEntry[] = useMemo(() => {
    const list: CommandEntry[] = [];
    if (canSync) {
      list.push({ key: "sync", label: syncing ? "Synchronisation en cours…" : "Synchroniser maintenant", group: "Actions", icon: RefreshCw, run: runSync });
    }
    list.push({ key: "integrations", label: "Ouvrir les intégrations", group: "Actions", icon: Plug, run: () => go("/settings/integrations") });
    list.push({ key: "logout", label: "Se déconnecter", group: "Actions", icon: LogOut, run: () => { void fetch("/api/auth/logout", { method: "POST" }).then(() => { router.push("/login"); router.refresh(); }); close(); } });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSync, syncing, storeId]);

  const navEntries: CommandEntry[] = navItems.map((n) => ({
    key: n.href,
    label: n.label,
    group: n.group,
    icon: NAV_ICONS[n.href] ?? Search,
    run: () => go(n.href),
  }));

  const q = query.trim().toLowerCase();
  const filtered = q === "" ? [...navEntries, ...actions] : [...navEntries, ...actions].filter((e) => e.label.toLowerCase().includes(q));

  const askCopilot: CommandEntry | null =
    q.length > 2
      ? { key: "ask-copilot", label: `Demander au Copilot : "${query.trim()}"`, group: "Copilot", icon: Bot, run: () => go(`/assistant?q=${encodeURIComponent(query.trim())}`) }
      : null;

  const results = askCopilot ? [...filtered, askCopilot] : filtered;

  function onKeyDownInput(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      results[activeIndex]?.run();
    }
  }

  // Regroupe les résultats visibles par section, en conservant l'ordre.
  const groups: Array<{ label: string; entries: CommandEntry[] }> = [];
  for (const entry of results) {
    let g = groups.find((x) => x.label === entry.group);
    if (!g) {
      g = { label: entry.group, entries: [] };
      groups.push(g);
    }
    g.entries.push(entry);
  }

  return (
    <>
      <button type="button" className="command-trigger" onClick={() => setOpen(true)} aria-label="Ouvrir la barre de commande">
        <Search size={15} />
        Rechercher ou exécuter une commande…
        <span className="command-trigger-kbd">
          <kbd>⌘</kbd>
          <kbd>K</kbd>
        </span>
      </button>

      <Modal open={open} onClose={close} labelledBy="command-bar-input">
        <div className="command-input-row">
          <Search size={16} color="var(--color-text-faint)" />
          <input
            id="command-bar-input"
            ref={inputRef}
            className="command-input"
            placeholder="Rechercher une page, une action, ou poser une question…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onKeyDownInput}
          />
          <span className="command-trigger-kbd" style={{ marginLeft: 0 }}>
            <CornerDownLeft size={12} />
          </span>
        </div>
        <div className="command-results">
          {results.length === 0 ? (
            <div className="command-empty">Aucun résultat pour « {query} ».</div>
          ) : (
            groups.map((g) => (
              <div key={g.label}>
                <div className="command-group-label">{g.label}</div>
                {g.entries.map((entry) => {
                  const idx = results.indexOf(entry);
                  const Icon = entry.icon;
                  return (
                    <div
                      key={entry.key}
                      className={`command-item ${idx === activeIndex ? "active" : ""}`}
                      onMouseEnter={() => setActiveIndex(idx)}
                      onClick={() => entry.run()}
                      role="option"
                      aria-selected={idx === activeIndex}
                    >
                      <Icon size={15} strokeWidth={2} />
                      {entry.label}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </Modal>
    </>
  );
}
