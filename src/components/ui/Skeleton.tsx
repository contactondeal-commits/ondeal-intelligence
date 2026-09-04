/** Placeholder de chargement — utiliser au lieu d'un spinner générique quand la forme du contenu final est connue. */
export default function Skeleton({ lines = 3, width }: { lines?: number; width?: (string | number)[] }) {
  return (
    <div aria-hidden="true" aria-busy="true">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="skeleton skeleton-block" style={{ width: width?.[i] ?? (i === lines - 1 ? "60%" : "100%") }} />
      ))}
    </div>
  );
}
