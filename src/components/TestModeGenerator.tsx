"use client";

// Portage du générateur d'avis Judge.me fictifs (fourni par l'utilisateur,
// initialement une extension Shopify Admin) en page Next.js standard.
// Logique de génération conservée à l'identique ; UI adaptée en HTML/CSS
// standard puisque cette page ne s'exécute plus dans le cadre d'une
// extension d'admin Shopify mais dans l'application SaaS.

import { useMemo, useState } from "react";

type GeneratedReview = {
  handle: string;
  rating: number;
  title: string;
  body: string;
  author: string;
  email: string;
  date: string;
};

const FIRST_NAMES = [
  "Camille", "Emma", "Chloé", "Léa", "Manon", "Julie", "Sarah", "Laura", "Clara", "Alice",
  "Thomas", "Lucas", "Hugo", "Nathan", "Louis", "Maxime", "Antoine", "Julien", "Alexandre", "Nicolas",
];

const REVIEW_TITLES = [
  "Très bon produit", "Je recommande", "Excellent rapport qualité-prix", "Très satisfait", "Bonne surprise",
  "Parfait pour mon utilisation", "Produit de qualité", "Conforme à mes attentes", "Très pratique", "Belle qualité",
];

const REVIEW_BODIES = [
  "Produit conforme à la description. La qualité est au rendez-vous et l'utilisation est très agréable.",
  "Je suis satisfait de mon achat. Le produit correspond bien à mes attentes et semble de bonne qualité.",
  "Très bonne expérience avec ce produit. Il est pratique, simple à utiliser et conforme à la présentation.",
  "La qualité est vraiment appréciable. Le produit correspond parfaitement à ce que je recherchais.",
  "Bon produit, bien fini et agréable à utiliser. Livraison et expérience globales satisfaisantes.",
  "Je ne regrette pas mon choix. Le produit est conforme aux informations présentées sur la boutique.",
  "Une bonne découverte. Le produit est pratique et répond bien à son utilisation prévue.",
  "Produit intéressant avec une bonne qualité de fabrication. Je suis globalement très satisfait.",
];

const DOMAINS = ["example.test", "demo.test", "test.example"];

function randomItem<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}
function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function generateEmail(firstName: string, index: number): string {
  const normalized = firstName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return `${normalized}.${index}@${randomItem(DOMAINS)}`;
}
function generateDate(startDate: string, endDate: string): string {
  const start = new Date(`${startDate}T00:00:00`).getTime();
  const end = new Date(`${endDate}T23:59:59`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || start > end) return startDate;
  return new Date(randomInt(start, end)).toISOString().slice(0, 10);
}
function escapeCsv(value: string): string {
  const escaped = value.replace(/"/g, '""');
  return /[",\n\r]/.test(value) ? `"${escaped}"` : escaped;
}
function buildCsv(reviews: GeneratedReview[]): string {
  const header = "product_handle,rating,title,body,author,email,created_at,reply";
  const lines = [header];
  for (const r of reviews) {
    lines.push([escapeCsv(r.handle), String(r.rating), escapeCsv(r.title), escapeCsv(r.body), escapeCsv(r.author), escapeCsv(r.email), escapeCsv(r.date), ""].join(","));
  }
  return lines.join("\n");
}

export default function TestModeGenerator({
  storeId,
  products,
}: {
  storeId: string;
  products: Array<{ handle: string; title: string }>;
}) {
  const [manualHandles, setManualHandles] = useState("");
  const [reviews, setReviews] = useState<GeneratedReview[]>([]);
  const [reviewsPerProduct, setReviewsPerProduct] = useState(5);
  const [ratingMin, setRatingMin] = useState(4);
  const [ratingMax, setRatingMax] = useState(5);
  const [startDate, setStartDate] = useState("2025-01-01");
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const targetProducts = useMemo(() => {
    if (products.length > 0) return products;
    return manualHandles
      .split("\n")
      .map((h) => h.trim())
      .filter(Boolean)
      .map((h) => ({ handle: h, title: h }));
  }, [products, manualHandles]);

  const csvContent = useMemo(() => buildCsv(reviews), [reviews]);
  const dataUrl = useMemo(
    () => (reviews.length > 0 ? `data:text/csv;charset=utf-8,${encodeURIComponent(csvContent)}` : ""),
    [csvContent, reviews.length],
  );

  function generate() {
    const generated: GeneratedReview[] = [];
    const safeCount = Math.max(1, Math.min(100, reviewsPerProduct));
    const safeMin = Math.max(1, Math.min(5, Math.min(ratingMin, ratingMax)));
    const safeMax = Math.max(1, Math.min(5, Math.max(ratingMin, ratingMax)));
    let index = 0;
    for (const product of targetProducts) {
      for (let i = 0; i < safeCount; i++) {
        const author = randomItem(FIRST_NAMES);
        generated.push({
          handle: product.handle,
          rating: randomInt(safeMin, safeMax),
          title: randomItem(REVIEW_TITLES),
          body: randomItem(REVIEW_BODIES),
          author,
          email: generateEmail(author, index),
          date: generateDate(startDate, endDate),
        });
        index += 1;
      }
    }
    setReviews(generated);
    setSavedMsg(null);
  }

  async function saveSample() {
    setSaving(true);
    setSavedMsg(null);
    const res = await fetch("/api/test-reviews", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ storeId, reviews: reviews.slice(0, 200) }),
    });
    setSaving(false);
    setSavedMsg(res.ok ? `${Math.min(reviews.length, 200)} avis fictifs enregistrés dans la table Mode Test (jamais dans Review Intelligence).` : "Échec de l'enregistrement.");
  }

  return (
    <div className="card">
      <h1 style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>Générateur d'avis Judge.me — Mode Test</h1>
      <p className="page-subtitle" style={{ marginBottom: 18 }}>
        Génère un jeu de données fictif pour tester l'import CSV Judge.me. Auteurs et emails sont volontairement fictifs.
      </p>

      {targetProducts.length === 0 && (
        <div className="field">
          <label>Aucun produit synchronisé — saisissez des handles de test (un par ligne)</label>
          <textarea className="input" rows={4} value={manualHandles} onChange={(e) => setManualHandles(e.target.value)} placeholder={"produit-test-1\nproduit-test-2"} />
        </div>
      )}

      <div className="grid grid-3" style={{ marginBottom: 14 }}>
        <div className="field">
          <label>Avis par produit</label>
          <input className="input" type="number" min={1} max={100} value={reviewsPerProduct} onChange={(e) => setReviewsPerProduct(Number(e.target.value) || 5)} />
        </div>
        <div className="field">
          <label>Note minimale</label>
          <input className="input" type="number" min={1} max={5} value={ratingMin} onChange={(e) => setRatingMin(Number(e.target.value) || 1)} />
        </div>
        <div className="field">
          <label>Note maximale</label>
          <input className="input" type="number" min={1} max={5} value={ratingMax} onChange={(e) => setRatingMax(Number(e.target.value) || 5)} />
        </div>
        <div className="field">
          <label>Date de début</label>
          <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div className="field">
          <label>Date de fin</label>
          <input className="input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <button className="btn btn-primary" onClick={generate} disabled={targetProducts.length === 0}>Générer les avis</button>
        {reviews.length > 0 && (
          <>
            <a className="btn btn-secondary" href={dataUrl} download="judgeme-avis-fictifs.csv">Télécharger le CSV</a>
            <button className="btn btn-secondary" onClick={saveSample} disabled={saving}>
              {saving ? "Enregistrement…" : "Enregistrer un échantillon (base Mode Test)"}
            </button>
          </>
        )}
      </div>
      {savedMsg && <p className="unavailable-note" style={{ marginTop: 10 }}>{savedMsg}</p>}

      {reviews.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <p style={{ fontSize: 13.5, fontWeight: 700 }}>{reviews.length} avis fictifs générés pour {targetProducts.length} produit(s).</p>
          <table className="table">
            <thead><tr><th>Produit</th><th>Note</th><th>Titre</th><th>Auteur</th><th>Date</th></tr></thead>
            <tbody>
              {reviews.slice(0, 25).map((r, i) => (
                <tr key={i}>
                  <td>{r.handle}</td><td>{r.rating} ★</td><td>{r.title}</td><td>{r.author}</td><td>{r.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {reviews.length > 25 && <p className="unavailable-note">… et {reviews.length - 25} de plus (voir le CSV complet).</p>}
        </div>
      )}
    </div>
  );
}
