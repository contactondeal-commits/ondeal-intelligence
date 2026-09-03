import { NextRequest, NextResponse } from "next/server";

// Route utilitaire temporaire — capture le callback OAuth Shopify et
// échange le "code" contre un access_token Admin API, puis l'affiche à
// l'écran pour copier/coller dans Réglages > Intégrations. Ne stocke rien
// en base : aucune dépendance à une session utilisateur, donc pas de
// redirection possible ici (contrairement à "/", qui redirige vers
// /login si personne n'est connecté et fait perdre les paramètres de
// l'URL). À supprimer une fois la connexion Shopify effectuée.

// Lus depuis les variables d'environnement Vercel (jamais commités en dur —
// voir SHOPIFY_APP_CLIENT_ID / SHOPIFY_APP_CLIENT_SECRET dans les réglages
// du projet Vercel).
const CLIENT_ID = process.env.SHOPIFY_APP_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_APP_CLIENT_SECRET;

function html(body: string, status = 200) {
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><title>Shopify OAuth</title>
    <style>
      body{font-family:system-ui,sans-serif;background:#0f0f14;color:#eee;padding:2rem;max-width:720px;margin:0 auto}
      textarea{width:100%;min-height:5rem;background:#1a1a22;color:#8ff0a4;border:1px solid #333;border-radius:8px;padding:.75rem;font-family:monospace;font-size:.95rem}
      code{background:#1a1a22;padding:.15rem .4rem;border-radius:4px}
      .field{margin-bottom:1.25rem}
      label{display:block;margin-bottom:.35rem;color:#aaa;font-size:.85rem}
      h1{font-size:1.2rem}
    </style></head><body>${body}</body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const code = sp.get("code");
  const shop = sp.get("shop");
  const state = sp.get("state");

  if (!code || !shop) {
    return html(
      `<h1>Callback OAuth Shopify — paramètres manquants</h1>
       <p>Reçu : code=<code>${code ?? "∅"}</code>, shop=<code>${shop ?? "∅"}</code>, state=<code>${state ?? "∅"}</code></p>
       <p>Requête complète : <code>${req.nextUrl.toString()}</code></p>`,
      400,
    );
  }

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return html(
      `<h1>Configuration manquante</h1>
       <p>Les variables d'environnement <code>SHOPIFY_APP_CLIENT_ID</code> et <code>SHOPIFY_APP_CLIENT_SECRET</code> doivent être définies sur Vercel avant de réessayer.</p>`,
      500,
    );
  }

  try {
    const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code }),
    });
    const text = await res.text();
    if (!res.ok) {
      return html(`<h1>Échec de l'échange du code</h1><p>HTTP ${res.status}</p><pre>${text}</pre>`, 502);
    }
    const json = JSON.parse(text) as { access_token?: string; scope?: string };
    if (!json.access_token) {
      return html(`<h1>Réponse inattendue de Shopify</h1><pre>${text}</pre>`, 502);
    }

    return html(`
      <h1>✅ Boutique connectée : ${shop}</h1>
      <p>Copie ces deux valeurs dans <strong>Réglages &gt; Intégrations &gt; Shopify</strong> :</p>
      <div class="field">
        <label>Domaine</label>
        <textarea readonly onclick="this.select()">${shop}</textarea>
      </div>
      <div class="field">
        <label>Jeton d'accès (access token)</label>
        <textarea readonly onclick="this.select()">${json.access_token}</textarea>
      </div>
      <p style="color:#888;font-size:.85rem">Scopes accordés : ${json.scope ?? "n/a"} · state=${state ?? "n/a"}</p>
    `);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return html(`<h1>Erreur serveur</h1><pre>${message}</pre>`, 500);
  }
}
