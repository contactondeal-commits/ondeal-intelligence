import type { ReactNode } from "react";

export type BadgeTone = "urgent" | "opportunity" | "suggestion" | "neutral" | "info" | "demo" | "test";

const TONE_CLASS: Record<BadgeTone, string> = {
  urgent: "badge-urgent",
  opportunity: "badge-opportunity",
  suggestion: "badge-suggestion",
  neutral: "badge-neutral",
  info: "badge-neutral",
  demo: "badge-demo",
  test: "badge-test",
};

export default function Badge({ tone = "neutral", icon, children }: { tone?: BadgeTone; icon?: ReactNode; children: ReactNode }) {
  return (
    <span className={`badge ${TONE_CLASS[tone]}`}>
      {icon && <span aria-hidden style={{ display: "inline-flex" }}>{icon}</span>}
      {children}
    </span>
  );
}
