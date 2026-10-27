#!/usr/bin/env bash
set -euo pipefail

ICON_DIR="ios/App/App/Assets.xcassets/AppIcon.appiconset"
SRC="$ICON_DIR/AppIcon-512@2x.png"

if [[ ! -f "$SRC" ]]; then
  echo "Missing source icon: $SRC" >&2
  exit 1
fi

if command -v magick >/dev/null 2>&1; then
  CONVERT=(magick)
elif command -v convert >/dev/null 2>&1; then
  CONVERT=(convert)
else
  echo "ImageMagick is required (magick/convert not found)." >&2
  exit 1
fi

resize() {
  local size="$1"
  local out="$2"
  "${CONVERT[@]}" "$SRC" -resize "${size}x${size}" "$ICON_DIR/$out"
}

resize 1024 "AppIcon-1024.png"

# iPhone
resize 40 "Icon-App-20x20@2x.png"
resize 60 "Icon-App-20x20@3x.png"
resize 58 "Icon-App-29x29@2x.png"
resize 87 "Icon-App-29x29@3x.png"
resize 80 "Icon-App-40x40@2x.png"
resize 120 "Icon-App-40x40@3x.png"
resize 120 "Icon-App-60x60@2x.png"
resize 180 "Icon-App-60x60@3x.png"

# iPad
resize 20 "Icon-App-20x20@1x~ipad.png"
resize 40 "Icon-App-20x20@2x~ipad.png"
resize 29 "Icon-App-29x29@1x~ipad.png"
resize 58 "Icon-App-29x29@2x~ipad.png"
resize 40 "Icon-App-40x40@1x~ipad.png"
resize 80 "Icon-App-40x40@2x~ipad.png"
resize 76 "Icon-App-76x76@1x~ipad.png"
resize 152 "Icon-App-76x76@2x~ipad.png"
resize 167 "Icon-App-83.5x83.5@2x~ipad.png"

echo "Generated iOS AppIcon assets in $ICON_DIR"
