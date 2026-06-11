#!/bin/sh
# Build the app icon artifacts from assets/icon.svg:
#   - packages/desktop/build/icon.icns  (all 10 macOS representations)
#   - packages/desktop/build/icon.png   (1024px master)
# Both are COMMITTED so CI needs no SVG toolchain (rsvg-convert is not
# installed on the runners; iconutil is macOS-only).
#
# We build the .icns ourselves because electron-builder's PNG->ICNS
# conversion produced CORRUPT 16/32px representations (rainbow noise in
# Finder list view / Get Info). electron-builder uses a provided .icns as-is.
#
# Small sizes render with a thicker glyph stroke — the 2px line art reads as
# a faint smudge at 16px otherwise.
#
#   brew install librsvg   # provides rsvg-convert
set -eu
cd "$(dirname "$0")/.."

SVG=assets/icon.svg
OUT=packages/desktop/build
ICONSET=$(mktemp -d)/icon.iconset
mkdir -p "$ICONSET"

# render <pixels> <outfile> — picks a stroke width that reads at that size.
render() {
  px=$1
  out=$2
  case $px in
    16) sw=4 ;;
    32) sw=3 ;;
    64) sw=2.5 ;;
    *) sw=2 ;;
  esac
  sed "s/stroke-width=\"2\"/stroke-width=\"$sw\"/" "$SVG" |
    rsvg-convert -w "$px" -h "$px" -o "$out"
}

render 16 "$ICONSET/icon_16x16.png"
render 32 "$ICONSET/icon_16x16@2x.png"
render 32 "$ICONSET/icon_32x32.png"
render 64 "$ICONSET/icon_32x32@2x.png"
render 128 "$ICONSET/icon_128x128.png"
render 256 "$ICONSET/icon_128x128@2x.png"
render 256 "$ICONSET/icon_256x256.png"
render 512 "$ICONSET/icon_256x256@2x.png"
render 512 "$ICONSET/icon_512x512.png"
render 1024 "$ICONSET/icon_512x512@2x.png"

iconutil -c icns "$ICONSET" -o "$OUT/icon.icns"
render 1024 "$OUT/icon.png"
rm -rf "$(dirname "$ICONSET")"
echo "wrote $OUT/icon.icns and $OUT/icon.png"
