import { Car, Code, Dumbbell, Flame, History, Moon, PartyPopper, Star, Wand2 } from "lucide-react";
import type { SmartKind } from "../../../logic/smart-playlists";

/** Icons for the Smart Mixes (sidebar + Home cards). One shared map so the
 *  two surfaces can't drift. */
export const SMART_ICONS: Record<SmartKind, typeof Star> = {
  "for-you": Wand2,
  "top-rated": Star,
  "heavy-rotation": Flame,
  rediscover: History,
};

export const MIX_ICONS: Record<string, typeof Star> = {
  driving: Car,
  workout: Dumbbell,
  chill: Moon,
  coding: Code,
  party: PartyPopper,
};
