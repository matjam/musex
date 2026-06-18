#!/usr/bin/env bash
# Build the musex app icon artifacts from the raster master assets/icon-master.png
# (a metallic disc on a blue→purple gradient, drawn as a full-bleed squircle whose
#  rounded corners are filled solid black). Produces:
#   - packages/desktop/build/icon.icns + icon.png — macOS: a squircle with the
#       black corners made TRANSPARENT (macOS draws the rounded shape itself).
#   - packages/mobile/assets/icon.png — iOS: FULL-BLEED OPAQUE (the gradient is
#       extended into the corners; iOS masks the rounded corners itself and
#       REJECTS transparency).
# All outputs are COMMITTED (CI has no ImageMagick). Re-run after changing the master.
#
# The corners are removed by a flood-fill from the four corners (NOT a global
# chroma-key) so the disc's own dark center/shadows — which are also near-black —
# are preserved. We build the .icns ourselves because electron-builder's
# PNG->ICNS conversion produced CORRUPT 16/32px representations.
#
#   brew install imagemagick   # provides magick; iconutil is macOS-only
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MASTER="$ROOT/assets/icon-master.png"
[ -f "$MASTER" ] || { echo "missing master: $MASTER" >&2; exit 1; }
command -v magick >/dev/null || { echo "ImageMagick (magick) required" >&2; exit 1; }
command -v iconutil >/dev/null || { echo "iconutil (macOS) required" >&2; exit 1; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
read -r W H < <(magick identify -format "%w %h" "$MASTER")
X=$((W - 1)); Y=$((H - 1))

# Transparent-corner master: flood-fill the connected black corner regions to
# alpha; the gradient ring stops the flood, so the disc interior is untouched.
magick "$MASTER" -alpha set -channel RGBA -fuzz 20% -fill none \
  -draw "alpha 0,0 floodfill" -draw "alpha $X,0 floodfill" \
  -draw "alpha 0,$Y floodfill" -draw "alpha $X,$Y floodfill" \
  "$TMP/transparent.png"

# --- Desktop (macOS): squircle with transparent corners ---
magick "$TMP/transparent.png" -resize 1024x1024 "$ROOT/packages/desktop/build/icon.png"
ICONSET="$TMP/musex.iconset"; mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  magick "$TMP/transparent.png" -resize "${s}x${s}"        "$ICONSET/icon_${s}x${s}.png"
  magick "$TMP/transparent.png" -resize "$((s * 2))x$((s * 2))" "$ICONSET/icon_${s}x${s}@2x.png"
done
iconutil -c icns "$ICONSET" -o "$ROOT/packages/desktop/build/icon.icns"

# --- Mobile (iOS): full-bleed opaque (fill corners with the gradient) ---
# Background = the master scaled up + blurred so the gradient covers the frame;
# composite the transparent-corner squircle over it, then drop the alpha.
magick "$MASTER" -resize 135% -gravity center -extent "${W}x${H}" -blur 0x70 "$TMP/bg.png"
magick "$TMP/bg.png" "$TMP/transparent.png" -gravity center -composite \
  -alpha remove -alpha off -resize 1024x1024 "$ROOT/packages/mobile/assets/icon.png"

echo "icons generated:"
echo "  desktop: packages/desktop/build/icon.icns + icon.png (transparent squircle)"
echo "  mobile : packages/mobile/assets/icon.png (full-bleed opaque)"
