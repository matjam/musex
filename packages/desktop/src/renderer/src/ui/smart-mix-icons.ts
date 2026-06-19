import type { SmartKind } from "@musex/core";
import { parseDecadeKind } from "@musex/core";
import {
  CalendarDays,
  Car,
  Clock,
  Code,
  Dumbbell,
  Flame,
  History,
  type LucideIcon,
  Moon,
  PartyPopper,
  Star,
  Wand2,
} from "lucide-react";

/** Icons for the rule-based + daily Smart Mixes (sidebar + Home cards). One
 *  shared map so the two surfaces can't drift. Decade mixes use a single shared
 *  glyph via `smartIcon`. */
const RULE_ICONS: Record<string, LucideIcon> = {
  "for-you": Wand2,
  "top-rated": Star,
  "heavy-rotation": Flame,
  rediscover: History,
  daily: CalendarDays,
};

/** Icon for any SmartKind, including the parametric decade kinds. */
export function smartIcon(kind: SmartKind): LucideIcon {
  if (parseDecadeKind(kind) !== null) return Clock;
  return RULE_ICONS[kind] ?? Star;
}

export const MIX_ICONS: Record<string, LucideIcon> = {
  driving: Car,
  workout: Dumbbell,
  chill: Moon,
  coding: Code,
  party: PartyPopper,
};
