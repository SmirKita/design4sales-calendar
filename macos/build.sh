#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
export CLANG_MODULE_CACHE_PATH="${CLANG_MODULE_CACHE_PATH:-$(mktemp -d "${TMPDIR:-/tmp}/d4s-swift.XXXXXX")}"
./node_modules/.bin/vite build --config macos/vite.config.js
grep -q '<script defer src=' dist-mac/index.html
grep -q '<link rel="stylesheet"' dist-mac/index.html
app="${D4S_APP_PATH:-release/Design4Sales Calendar.app}"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp macos/Info.plist "$app/Contents/Info.plist"
rm -rf "$app/Contents/Resources/Web"
ditto dist-mac "$app/Contents/Resources/Web"
flags=()
if [[ "${D4S_SMOKE:-0}" == 1 ]]; then flags=(-D D4S_SMOKE); fi
xcrun swiftc -target arm64-apple-macos14.0 -O ${flags[@]+"${flags[@]}"} macos/main.swift macos/Reminders.swift macos/StateFile.swift macos/Smoke.swift -o "$app/Contents/MacOS/Design4SalesCalendar"
codesign --force --sign - "$app"
codesign --verify --strict "$app"
