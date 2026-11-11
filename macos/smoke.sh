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
python3 - "$D4S_SMOKE_STATE/calendar-state.json" <<'PYTHON'
import json
import sys
from pathlib import Path
path = Path(sys.argv[1])
data = json.loads(path.read_text())
data["state"].pop("@design4sales/data-updates", None)
data["state"]["2026-10-27-photo-photoshop-ai"] = {
    "resultNote": "Keep during update",
    "phases": {"publication": "planned"},
    "placements": {
        "tg": {"enabled": True, "reminder": True, "status": "planned", "date": "2027-02-21"},
        "vk": {"enabled": True, "reminder": True, "status": "planned", "date": "2027-02-21"},
    },
}
data["manifest"]["reminders"].append({
    "id": "2026-10-27-photo-photoshop-ai:tg",
    "title": "Telegram | Old plan", "notes": "", "due": "2027-02-21T07:30:00.000Z", "alarm": "2027-02-21T07:15:00.000Z",
})
path.write_text(json.dumps(data))
PYTHON
D4S_SMOKE_STAGE=upgrade "$binary" --preview
printf 'broken JSON' > "$D4S_SMOKE_STATE/calendar-state.json"
D4S_SMOKE_STAGE=recover "$binary" --preview
