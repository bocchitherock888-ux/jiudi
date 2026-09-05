#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/就地.app"
BUILD_DIR="$(mktemp -d "$ROOT/.jiudi-build.XXXXXX")"
# Only disposable output created by this invocation is cleaned up.
BACKUP=""
PUBLISHING=0
cleanup() {
  if [[ "$PUBLISHING" == 1 && ! -e "$APP" && -n "$BACKUP" && -e "$BACKUP" ]]; then mv "$BACKUP" "$APP"; fi
  if [[ -d "$BUILD_DIR" ]]; then /bin/rm -rf -- "$BUILD_DIR"; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
NEXT="$BUILD_DIR/就地.app"
mkdir -p "$NEXT/Contents/MacOS" "$NEXT/Contents/Resources" "$BUILD_DIR/module-cache"
swiftc -O -parse-as-library -module-cache-path "$BUILD_DIR/module-cache" \
  -o "$NEXT/Contents/MacOS/jiudi" "$ROOT/macos/JiudiApp.swift" \
  -framework Cocoa -framework WebKit
cp "$ROOT/macos/Info.plist" "$NEXT/Contents/Info.plist"
if [[ -f "$APP/Contents/Resources/AppIcon.icns" ]]; then
  cp "$APP/Contents/Resources/AppIcon.icns" "$NEXT/Contents/Resources/AppIcon.icns"
elif [[ -f "$ROOT/icon-1024.png" ]]; then
  SET="$BUILD_DIR/AppIcon.iconset"
  mkdir -p "$SET"
  for size in 16 32 128 256 512; do
    sips -z "$size" "$size" "$ROOT/icon-1024.png" --out "$SET/icon_${size}x${size}.png" >/dev/null
    double=$((size * 2))
    sips -z "$double" "$double" "$ROOT/icon-1024.png" --out "$SET/icon_${size}x${size}@2x.png" >/dev/null
  done
  iconutil -c icns "$SET" -o "$NEXT/Contents/Resources/AppIcon.icns"
fi
codesign --force --deep --sign - "$NEXT"
codesign --verify --deep --strict "$NEXT"
# Publish only after compilation and signing have succeeded; retain the previous app.
BACKUP=""
if [[ -e "$APP" ]]; then
  BACKUP_DIR="$ROOT/output/app-backups/$(date +%Y%m%d-%H%M%S)-$$"
  mkdir -p "$BACKUP_DIR"
  BACKUP="$BACKUP_DIR/就地.app"
  PUBLISHING=1
  mv "$APP" "$BACKUP"
fi
if ! mv "$NEXT" "$APP"; then
  if [[ -n "$BACKUP" ]]; then mv "$BACKUP" "$APP"; fi
  exit 1
fi
PUBLISHING=0
/usr/bin/touch "$APP"
echo "built $APP"
if [[ -n "$BACKUP" ]]; then echo "previous app: $BACKUP"; fi
