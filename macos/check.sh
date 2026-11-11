#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
scratch="$(mktemp -d "${TMPDIR:-/tmp}/d4s-check.XXXXXX")"
trap 'rm -rf "$scratch"' EXIT
export CLANG_MODULE_CACHE_PATH="${CLANG_MODULE_CACHE_PATH:-$scratch/modules}"
xcrun swiftc -target arm64-apple-macos14.0 macos/Tests.swift macos/Reminders.swift macos/StateFile.swift -o "$scratch/tests"
"$scratch/tests"
