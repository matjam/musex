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
# Command substitution (not `read`): `magick identify` emits no trailing
# newline, which makes `read` return non-zero at EOF → `set -e` would abort.
W="$(magick identify -format "%w" "$MASTER")"
H="$(magick identify -format "%h" "$MASTER")"
X=$((W - 1)); Y=$((H - 1))

# Transparent-corner master: flood-fill the connected black corner regions to
# alpha; the gradient ring stops the flood, so the disc interior is untouched.
magick "$MASTER" -alpha set -channel RGBA -fuzz 20% -fill none \
  -draw "alpha 0,0 floodfill" -draw "alpha $X,0 floodfill" \
  -draw "alpha 0,$Y floodfill" -draw "alpha $X,$Y floodfill" \
  "$TMP/transparent.png"

# --- Desktop (macOS): squircle with transparent corners, INSET per the macOS
# icon grid (~824px body in a 1024 canvas, transparent padding around it). A
# full-bleed squircle renders OVERSIZED in the Dock vs other apps, which follow
# the grid; the inset makes musex match its neighbours. (iOS stays full-bleed.)
DESKTOP_BODY=824
magick "$TMP/transparent.png" -resize "${DESKTOP_BODY}x${DESKTOP_BODY}" \
  -background none -gravity center -extent 1024x1024 "$TMP/desktop.png"
magick "$TMP/desktop.png" -resize 1024x1024 "$ROOT/packages/desktop/build/icon.png"
ICONSET="$TMP/musex.iconset"; mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  magick "$TMP/desktop.png" -resize "${s}x${s}"        "$ICONSET/icon_${s}x${s}.png"
  magick "$TMP/desktop.png" -resize "$((s * 2))x$((s * 2))" "$ICONSET/icon_${s}x${s}@2x.png"
done
iconutil -c icns "$ICONSET" -o "$ROOT/packages/desktop/build/icon.icns"

# --- Windows: multi-size .ico (committed; CI has no ImageMagick) ---
# Windows draws the icon as-is (no macOS-grid inset), so use the transparent-
# corner squircle directly. auto-resize bakes the standard Windows icon sizes.
magick "$TMP/transparent.png" -define icon:auto-resize=256,128,64,48,32,16 \
  "$ROOT/packages/desktop/build/icon.ico"

# --- Linux: multi-size hicolor PNG set (committed; CI has no ImageMagick) ---
# electron-builder's linux.icon points at this DIRECTORY. A single PNG would be
# baked into the AppImage/deb as a lone 1024x1024, which is NOT in the freedesktop
# hicolor theme index (max 512x512) → no launcher icon. Linux draws the icon
# as-is (no macOS-grid inset), so use the full-bleed transparent-corner squircle.
LINUX_ICONS="$ROOT/packages/desktop/build/icons"; mkdir -p "$LINUX_ICONS"
for s in 16 32 48 64 128 256 512; do
  magick "$TMP/transparent.png" -resize "${s}x${s}" "$LINUX_ICONS/${s}x${s}.png"
done

# --- Mobile (iOS): full-bleed opaque (fill corners with the gradient) ---
# Background = the master scaled up + blurred so the gradient covers the frame;
# composite the transparent-corner squircle over it, then drop the alpha.
magick "$MASTER" -resize 135% -gravity center -extent "${W}x${H}" -blur 0x70 "$TMP/bg.png"
magick "$TMP/bg.png" "$TMP/transparent.png" -gravity center -composite \
  -alpha remove -alpha off -resize 1024x1024 "$ROOT/packages/mobile/assets/icon.png"

echo "icons generated:"
echo "  desktop: packages/desktop/build/icon.icns + icon.png (transparent squircle)"
echo "  windows: packages/desktop/build/icon.ico (multi-size transparent squircle)"
echo "  linux  : packages/desktop/build/icons/NxN.png (hicolor set, transparent squircle)"
echo "  mobile : packages/mobile/assets/icon.png (full-bleed opaque)"
