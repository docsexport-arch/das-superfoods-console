// The highest db/NNN this build was written against. tests/migrations.test.js
// reads the db/ directory and fails if this number is stale — a stale constant
// would turn the drift banner green over SQL that was never run (Bible §6).
export const EXPECTED_MIGRATION = 10;

// Compares the ledger with what this build expects. It reads every id in the
// window, not just the maximum: a skipped migration in the middle is drift
// that max(id) cannot see.
export function computeMigrationDrift(appliedIds, expected = EXPECTED_MIGRATION) {
  const applied = new Set(appliedIds);
  const missing = [];
  for (let id = 1; id <= expected; id += 1) {
    if (!applied.has(id)) missing.push(id);
  }
  const ahead = [...applied].filter((id) => id > expected).sort((a, b) => a - b);
  return { missing, ahead, inSync: missing.length === 0 && ahead.length === 0 };
}

export function describeDrift({ missing, ahead }) {
  const parts = [];
  if (missing.length) {
    parts.push(`Not applied to the database: ${missing.map((id) => "db/" + String(id).padStart(3, "0")).join(", ")}. `
      + "Read each file's header before running it — a superseded migration must not be re-run.");
  }
  if (ahead.length) {
    parts.push(`The database is ahead of this build (${ahead.map((id) => "db/" + String(id).padStart(3, "0")).join(", ")}). `
      + "A newer version of the console has been deployed — reload the page.");
  }
  return parts.join(" ");
}
