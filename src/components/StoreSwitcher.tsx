"use client";

import { useRouter, usePathname } from "next/navigation";

export default function StoreSwitcher({
  currentStoreId,
  stores,
}: {
  currentStoreId: string;
  stores: Array<{ id: string; name: string; isDemo: boolean }>;
}) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <select
      className="input"
      style={{ background: "rgba(255,255,255,0.1)", color: "#fff", borderColor: "rgba(255,255,255,0.2)", marginBottom: 8 }}
      value={currentStoreId}
      onChange={(e) => router.push(`${pathname}?store=${e.target.value}`)}
    >
      {stores.map((s) => (
        <option key={s.id} value={s.id} style={{ color: "#000" }}>
          {s.isDemo ? "🧪 " : ""}
          {s.name}
        </option>
      ))}
    </select>
  );
}
