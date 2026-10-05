#!/bin/zsh
# Builds Harvest.app and Harvest.dmg into app-build/ (ignored by git).
#
#   tools/build-app.sh
#
# Rebuild after moving the site folder: the app finds harvest.js by the path
# written into it here. Changes to harvest.js itself need NO rebuild — the app
# runs whatever is in the repo each time it opens.
set -e
cd "$(dirname "$0")/.."
REPO="$PWD"
NODE="$(command -v node || echo /usr/local/bin/node)"
OUT="$REPO/app-build"
APP="$OUT/Harvest.app"

rm -rf "$OUT"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
swiftc -O tools/HarvestApp.swift -o "$APP/Contents/MacOS/Harvest"

# The icon: drawn at 1024 by tools/HarvestIcon.swift, then cut to every size
# macOS asks for and packed into an .icns with iconutil.
ICONSET="$OUT/Harvest.iconset"
mkdir -p "$ICONSET"
swift tools/HarvestIcon.swift "$OUT/icon-1024.png"
for s in 16 32 128 256 512; do
  sips -z $s $s "$OUT/icon-1024.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  sips -z $((s * 2)) $((s * 2)) "$OUT/icon-1024.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/Harvest.icns"
rm -rf "$ICONSET"
xml() { print -r -- "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }
cat > "$APP/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>Harvest</string>
  <key>CFBundleIdentifier</key><string>work.rmaciel.harvest</string>
  <key>CFBundleName</key><string>Harvest</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleIconFile</key><string>Harvest</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>NSServices</key><array><dict>
    <key>NSMenuItem</key><dict><key>default</key><string>Add to Harvest Project…</string></dict>
    <key>NSMessage</key><string>addToProject</string>
    <key>NSPortName</key><string>Harvest</string>
    <key>NSSendFileTypes</key><array><string>public.item</string></array>
    <key>NSRequiredContext</key><dict/>
  </dict></array>
  <key>CFBundleURLTypes</key><array><dict>
    <key>CFBundleURLName</key><string>Harvest</string>
    <key>CFBundleURLSchemes</key><array><string>harvest</string></array>
  </dict></array>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
  <key>HarvestRepo</key><string>$(xml "$REPO")</string>
  <key>HarvestNode</key><string>$(xml "$NODE")</string>
</dict></plist>
EOF

# THE FINDER MENU (tools/HarvestFinder.swift): a Finder Sync extension inside
# the app. macOS runs extensions sandboxed; the one exception it is given is
# reading Harvest's own folder, for the project list the server writes there.
# It hands a choice to the app as a harvest:// address (registered above).
APPEX="$APP/Contents/PlugIns/HarvestFinder.appex"
mkdir -p "$APPEX/Contents/MacOS"
swiftc -O -parse-as-library -application-extension -module-name HarvestFinder tools/HarvestFinder.swift \
  -o "$APPEX/Contents/MacOS/HarvestFinder" -Xlinker -e -Xlinker _NSExtensionMain
cat > "$APPEX/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>HarvestFinder</string>
  <key>CFBundleIdentifier</key><string>work.rmaciel.harvest.finder</string>
  <key>CFBundleName</key><string>Harvest</string>
  <key>CFBundleDisplayName</key><string>Harvest</string>
  <key>CFBundlePackageType</key><string>XPC!</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSExtension</key><dict>
    <key>NSExtensionAttributes</key><dict/>
    <key>NSExtensionPointIdentifier</key><string>com.apple.FinderSync</string>
    <key>NSExtensionPrincipalClass</key><string>FinderSync</string>
  </dict>
</dict></plist>
EOF
ENT="$OUT/HarvestFinder.entitlements"
cat > "$ENT" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>com.apple.security.app-sandbox</key><true/>
  <key>com.apple.security.temporary-exception.files.home-relative-path.read-only</key>
  <array><string>/Library/Application Support/Harvest/</string></array>
</dict></plist>
EOF

# Ad-hoc signature: required to run on Apple Silicon, and enough for an app
# built on this Mac (it is never downloaded, so Gatekeeper never quarantines it).
# Finder metadata on files in this folder makes codesign refuse; strip it first.
# The extension is signed first, with its sandbox; then the app around it.
xattr -cr "$APP"
codesign --force --sign - --entitlements "$ENT" "$APPEX"
rm "$ENT"
codesign --force --sign - "$APP"

# A DMG with an Applications shortcut beside the app: open it, drag across.
STAGE="$OUT/dmg"
mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
hdiutil create -quiet -volname Harvest -srcfolder "$STAGE" -ov -format UDZO "$OUT/Harvest.dmg"
rm -rf "$STAGE"
echo "Built $APP and $OUT/Harvest.dmg"
