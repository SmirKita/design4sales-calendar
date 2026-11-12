const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

// Undo only the fields changed by the action. Later edits elsewhere remain intact.
export function undoRecordChanges(before, after, current) {
  const restored = { ...current };
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (equal(before[key], after[key])) continue;
    if (object(before[key]) && object(after[key]) && object(current[key])) {
      restored[key] = undoRecordChanges(before[key], after[key], current[key]);
    } else if (equal(current[key], after[key])) {
      if (Object.hasOwn(before, key)) restored[key] = before[key];
      else delete restored[key];
    }
  }
  return restored;
}

export function changePlacementRecord(record, platform, patch) {
  const placements = { ...record.placements, [platform]: { ...record.placements?.[platform], ...patch } };
  const enabled = Object.values(placements).filter((slot) => slot.enabled && slot.status !== "cancelled");
  const published = enabled.length > 0 && enabled.every((slot) => slot.status === "published");
  const next = { ...record, placements, shelved: false,
    phases: { ...record.phases, publication: published ? "published" : "planned" } };
  if (patch.status === "planned" || patch.status === "moved") delete next.publicationConfirmation;
  return next;
}

export function restorePlannedPlacements(record) {
  const next = { ...record, placements: { ...record.placements },
    phases: { ...record.phases, preparation: "ready", publication: "planned" }, shelved: false };
  for (const [id, slot] of Object.entries(next.placements)) {
    if (slot.enabled && slot.status === "published") next.placements[id] = { ...slot, status: "planned", publishedAt: null };
  }
  delete next.publicationConfirmation;
  return next;
}
