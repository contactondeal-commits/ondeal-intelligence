/**
 * Glyphe de marque OnDeal Intelligence — motif "Pulse" (04/09/2026) : une
 * ligne de signal qui culmine sur une étincelle, cohérent avec le concept
 * produit (Signaux / Centre d'intelligence). Tracé en `currentColor` pour
 * s'adapter au fond sur lequel il est posé (chip .brand-mark, favicon, etc.).
 */
export default function LogoMark({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 15 L6.5 15 L8.3 11.5 L11 18.5 L13.5 6.5 L16 15 L22 15" />
      <circle cx="13.5" cy="6.5" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
