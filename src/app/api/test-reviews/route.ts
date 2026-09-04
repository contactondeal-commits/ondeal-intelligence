import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireStoreAccess, AuthError } from "@/lib/auth";

const schema = z.object({
  storeId: z.string().min(1).max(64),
  reviews: z
    .array(
      z.object({
        handle: z.string().max(255),
        rating: z.number().int().min(1).max(5),
        title: z.string().max(200),
        body: z.string().max(2000),
        author: z.string().max(120),
        email: z.string().max(254),
      }),
    )
    .max(200),
});

// Écrit exclusivement dans TestReview — JAMAIS dans Review (avis réels).
// Séparation stricte imposée par le schéma de données lui-même (tables
// distinctes), pas seulement par une convention côté UI.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Payload invalide." }, { status: 400 });

  try {
    await requireStoreAccess(parsed.data.storeId);
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  await prisma.testReview.createMany({
    data: parsed.data.reviews.map((r) => ({ storeId: parsed.data.storeId, ...r })),
  });

  return NextResponse.json({ ok: true, count: parsed.data.reviews.length });
}
