"use client";

import { useRouter } from "next/navigation";

export default function LogoutButton() {
  const router = useRouter();
  return (
    <button
      className="sidebar-link"
      style={{ width: "100%", border: "none", background: "transparent", cursor: "pointer", textAlign: "left" }}
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        router.push("/login");
        router.refresh();
      }}
    >
      🚪 Déconnexion
    </button>
  );
}
