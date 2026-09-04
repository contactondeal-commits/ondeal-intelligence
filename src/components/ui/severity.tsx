import { AlertTriangle, TrendingUp, Lightbulb } from "lucide-react";
import type { BadgeTone } from "@/components/ui/Badge";

export type Severity = "URGENT" | "OPPORTUNITY" | "SUGGESTION";

export const SEVERITY_META: Record<Severity, { label: string; cls: string; tone: BadgeTone; icon: typeof AlertTriangle }> = {
  URGENT: { label: "Urgent", cls: "urgent", tone: "urgent", icon: AlertTriangle },
  OPPORTUNITY: { label: "Opportunité", cls: "opportunity", tone: "opportunity", icon: TrendingUp },
  SUGGESTION: { label: "Recommandation", cls: "suggestion", tone: "suggestion", icon: Lightbulb },
};
