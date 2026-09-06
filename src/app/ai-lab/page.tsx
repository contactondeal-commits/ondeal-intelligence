import { requirePlatformOwnerPage } from "@/lib/authz/requirePlatformOwnerPage";
import AiLabConsole from "@/app/ai-lab/AiLabConsole";

/**
 * ONDEAL AI CORE — PHASE 5 : "AI Lab Ultimate" (06/09/2026).
 *
 * PREMIÈRE page Platform-Owner-only du frontend, HORS du groupe (app)
 * (voir requirePlatformOwnerPage.ts pour la justification de placement).
 * Le gate serveur redirige AVANT même de renvoyer le HTML du composant
 * client — un non-Owner ne voit jamais cette page, même vide.
 */
export default async function AiLabPage() {
  const owner = await requirePlatformOwnerPage();
  return <AiLabConsole ownerEmail={owner.email} />;
}
