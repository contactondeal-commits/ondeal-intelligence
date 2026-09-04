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
      className="input store-switcher"
      aria-label="Changer de boutique"
      value={currentStoreId}
      onChange={(e) => router.push(`${pathname}?store=${e.target.value}`)}
    >
      {stores.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
          {s.isDemo ? " (démo)" : ""}
        </option>
      ))}
    </select>
  );
}
