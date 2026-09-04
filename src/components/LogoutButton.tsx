"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

export default function LogoutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="user-logout"
      title="Déconnexion"
      aria-label="Déconnexion"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        router.push("/login");
        router.refresh();
      }}
    >
      <LogOut size={14} strokeWidth={2} />
    </button>
  );
}
