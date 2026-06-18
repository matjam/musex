/** Shared design tokens — the source-of-truth values both apps derive from.
 *  Core stays pure: values only (no DOM/RN). Desktop derives CSS custom
 *  properties; mobile derives a theme object. Palette extracted verbatim from
 *  desktop's existing `ui/theme.css` `:root` so nothing visual regresses. */
export const colors = {
  bg: "#0d0e12",
  panel: "#16181f",
  panel2: "#21242d",
  sidebar: "#0a0b0e",
  text: "#e7e9ee",
  muted: "rgba(231,233,238,0.5)",
  line: "rgba(255,255,255,0.07)",
  green: "#54d2a0",
  purple: "#7c5cff",
  red: "#ff5f57",
  yellow: "#febc2e",
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 6, md: 10, lg: 16, pill: 999 } as const;

export const type = { caption: 12, body: 14, subtitle: 16, title: 20, hero: 28 } as const;
