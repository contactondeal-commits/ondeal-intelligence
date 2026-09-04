// Système d'icônes unique de l'application — lucide-react, jamais d'emoji.
// Une seule source de vérité pour associer une route/catégorie à une icône,
// afin que la navigation, la Command Bar et les badges restent cohérents.
import {
  LayoutDashboard,
  BrainCircuit,
  Package,
  Truck,
  Star,
  Coins,
  Megaphone,
  Bot,
  CheckSquare,
  History,
  Settings,
  AlertTriangle,
  TrendingUp,
  HelpCircle,
  type LucideIcon,
} from "lucide-react";

export const NAV_ICONS: Record<string, LucideIcon> = {
  "/dashboard": LayoutDashboard,
  "/intelligence": BrainCircuit,
  "/intelligence?filter=urgent": AlertTriangle,
  "/intelligence?filter=opportunity": TrendingUp,
  "/products": Package,
  "/stock": Truck,
  "/reviews": Star,
  "/pricing": Coins,
  "/marketing": Megaphone,
  "/assistant": Bot,
  "/actions": CheckSquare,
  "/audit-log": History,
  "/settings": Settings,
  "/guide": HelpCircle,
};
