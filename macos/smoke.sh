#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
scratch="$(mktemp -d "${TMPDIR:-/tmp}/d4s-smoke.XXXXXX")"
trap 'rm -rf "$scratch"' EXIT
app="$scratch/Design4Sales QA.app"
D4S_SMOKE=1 D4S_APP_PATH="$app" bash macos/build.sh
export D4S_SMOKE_STATE="$scratch/state"
binary="$app/Contents/MacOS/Design4SalesCalendar"
D4S_SMOKE_STAGE=create "$binary" --preview
D4S_SMOKE_STAGE=reopen "$binary" --preview
printf 'broken JSON' > "$D4S_SMOKE_STATE/calendar-state.json"
D4S_SMOKE_STAGE=recover "$binary" --preview
