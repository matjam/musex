#!/bin/sh
# Rasterize assets/icon.svg to the 1024px PNG electron-builder converts into
# the .icns (all sizes) at package time. Run after editing the SVG; the PNG
# is committed so CI needs no SVG toolchain.
#
#   brew install librsvg   # provides rsvg-convert
set -eu
cd "$(dirname "$0")/.."
rsvg-convert -w 1024 -h 1024 assets/icon.svg -o packages/desktop/build/icon.png
echo "wrote packages/desktop/build/icon.png"
