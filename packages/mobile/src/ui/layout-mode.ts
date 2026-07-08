export type LayoutMode = "phone" | "pad-portrait" | "pad-landscape";

/**
 * Pure layout-mode derivation: iPad gets the desktop-mirror layout (sidebar
 * landscape / icon rail portrait); everything else is the phone layout.
 * Square counts as portrait (width must strictly exceed height for landscape).
 *
 * Kept free of react-native imports so it runs under vitest (node); the
 * wrapping hook lives in `use-layout-mode.ts`.
 */
export function deriveLayoutMode(input: {
  width: number;
  height: number;
  isPad: boolean;
}): LayoutMode {
  if (!input.isPad) return "phone";
  return input.width > input.height ? "pad-landscape" : "pad-portrait";
}
