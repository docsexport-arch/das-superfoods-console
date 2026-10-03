// Gates. Each one states the CLASS of mistake it prevents (Build Bible §20) and
// reads the repository itself, so it catches what an author forgot to write.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { EXPECTED_MIGRATION, computeMigrationDrift } from "../src/lib/migrations.js";
import { RPC_CONTRACT } from "../src/lib/payloads.js";
import { SECTION_KEYS } from "../src/lib/db.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => readFileSync(join(ROOT, ...p), "utf8");

// db/NNN_name.sql, or the bootstrap wave db/001-005_bootstrap.sql. Files under
// db/pending/ are written but deliberately NOT applied yet, and are not read.
const migrationFiles = readdirSync(join(ROOT, "db"))
  .map((name) => ({ name, m: /^(\d{3})(?:-(\d{3}))?_.+\.sql$/.exec(name) }))
  .filter((f) => f.m)
  .map((f) => ({ name: f.name, first: Number(f.m[1]), last: Number(f.m[2] || f.m[1]) }))
  .sort((a, b) => a.first - b.first);

// SQL with "--" comment lines removed, so a comment that mentions a banned
// word explains the rule instead of tripping it.
const sqlCode = (name) => read("db", name).split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

function sourceFiles(dir) {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sourceFiles(join(dir, e.name)) : [join(dir, e.name)]);
}
const SRC = sourceFiles("src");

describe("migration ledger", () => {
  it("EXPECTED_MIGRATION equals the highest migration in db/", () => {
    // Class: a stale constant makes the drift banner report "in sync" over SQL
    // that was never run. Remedy: bump EXPECTED_MIGRATION in src/lib/migrations.js
    // in the same commit that adds the db/NNN file.
    const highest = Math.max(...migrationFiles.map((f) => f.last));
    expect(EXPECTED_MIGRATION).toBe(highest);
  });

  it("has no gap in the numbering", () => {
    let next = 1;
    for (const f of migrationFiles) { expect(f.first).toBe(next); next = f.last + 1; }
  });

  it("every migration after the bootstrap records its own id in the ledger", () => {
    // Class: a combined or skipped ledger row hides a migration that never ran.
    for (const f of migrationFiles.filter((x) => x.first >= 6)) {
      expect(sqlCode(f.name), `${f.name} must insert id ${f.first} into app_schema_migrations`)
        .toMatch(new RegExp(`app_schema_migrations[\\s\\S]*values \\(${f.first},`));
    }
  });

  it("drift names a migration skipped in the middle, which max(id) cannot see", () => {
    expect(computeMigrationDrift([1, 2, 3, 4, 5, 6, 8, 9], 9)).toEqual({ missing: [7], ahead: [], inSync: false });
    expect(computeMigrationDrift([1, 2, 3], 3).inSync).toBe(true);
    expect(computeMigrationDrift([1, 2, 3, 4], 3)).toEqual({ missing: [], ahead: [4], inSync: false });
  });
});

describe("SQL rules", () => {
  const afterBootstrap = migrationFiles.filter((f) => f.first >= 6);

  it("never takes today's date in UTC", () => {
    // Class: current_date is UTC — a document raised before 05:30 IST gets
    // yesterday's date. Use public.ist_today().
    for (const f of afterBootstrap) expect(sqlCode(f.name), f.name).not.toMatch(/\bcurrent_date\b/i);
  });

  it("never raises a SQLSTATE that PostgREST retries for ever", () => {
    for (const f of afterBootstrap) expect(sqlCode(f.name), f.name).not.toMatch(/errcode\s*=\s*'(40001|40P01)'/i);
  });

  it("every SECURITY DEFINER function pins its search_path", () => {
    for (const f of afterBootstrap) {
      const heads = sqlCode(f.name).match(/create or replace function[\s\S]*?\bas \$\$/gi) || [];
      for (const head of heads.filter((h) => /security definer/i.test(h))) {
        expect(head, `${f.name}: ${head.slice(0, 70)}`).toMatch(/set search_path = public/i);
      }
    }
  });
});

describe("RPC contract — nothing the client sends is silently discarded", () => {
  // Class: an RPC reads its payload key by key; a key it does not read never
  // lands and nothing says so. The latest definition of each function wins,
  // exactly as it does in Postgres.
  const allSql = migrationFiles.map((f) => sqlCode(f.name)).join("\n");
  const bodyOf = (fn) => {
    const re = new RegExp(`create or replace function public\\.${fn}\\([\\s\\S]*?\\n\\$\\$;`, "gi");
    const all = allSql.match(re);
    return all ? all[all.length - 1] : null;
  };

  for (const [fn, keys] of Object.entries(RPC_CONTRACT)) {
    it(`${fn} reads every key in its payload list`, () => {
      const body = bodyOf(fn);
      expect(body, `public.${fn} is not defined in db/`).toBeTruthy();
      const unread = keys.filter((k) => !body.includes(`'${k}'`));
      expect(unread, `public.${fn} would throw these away — read them in the SQL or drop them from payloads.js`).toEqual([]);
    });
  }
});

describe("client rules", () => {
  const code = (file) => read(file);

  it("writes only through RPCs — never straight into a table", () => {
    // Class: a multi-step change issued from the browser can stop half-way.
    for (const f of SRC) {
      expect(code(f), f).not.toMatch(/\.from\([^)]*\)\s*\.(insert|update|upsert|delete)\(/);
    }
  });

  it("never chains .catch on a supabase query builder", () => {
    // Class: the builder is a thenable with no .catch; the call throws a TypeError.
    for (const f of SRC) expect(code(f), f).not.toMatch(/sb\s*\.(from|rpc)\([^;]*\)\s*\.catch\(/);
  });

  it("leaves session locking and refresh to the library", () => {
    const db = code(join("src", "lib", "db.js"));
    expect(db).not.toMatch(/\block\s*:/);
    expect(db).not.toMatch(/autoRefreshToken/);
  });

  it("never derives today's date from toISOString()", () => {
    for (const f of SRC) expect(code(f), f).not.toMatch(/toISOString\(\)\s*\.(slice|substring|substr|split)/);
  });

  it("keeps every colour in tokens.css — no hex in a component", () => {
    // Class: a hardcoded colour is wrong in one of the two themes.
    for (const f of SRC.filter((x) => /\.jsx?$/.test(x))) {
      expect(code(f), f).not.toMatch(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![\w-])/);
    }
  });

  it("ships no secret key", () => {
    for (const f of SRC) {
      expect(code(f), f).not.toMatch(/sb_secret_|service_role/);
    }
  });

  it("uses the publishable key, not a legacy JWT", () => {
    expect(code(join("src", "config.js"))).toMatch(/sb_publishable_/);
    for (const f of SRC) expect(code(f), f).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/);
  });
});

describe("one list of sections, on every side", () => {
  // Class: the grant list drifting between the database, the data layer, the
  // screens and the account function — so the UI offers a tick-box the server
  // rejects, or hides a section it allows. The latest constraint in db/ wins.
  const quoted = (text) => [...text.matchAll(/["']([a-z]+)["']/g)].map((m) => m[1]);

  const constraint = migrationFiles
    .map((f) => sqlCode(f.name).match(/profiles_sections_valid\s+check \(sections <@ array\[([^\]]+)\]/))
    .filter(Boolean).pop();

  it("the database constraint is the reference", () => {
    expect(constraint, "no profiles_sections_valid constraint found in db/").toBeTruthy();
    expect(quoted(constraint[1])).toEqual(SECTION_KEYS);
  });

  it("the toolbar and tick-boxes in app.jsx list the same sections, in the same order", () => {
    const block = read("src", "app.jsx").match(/const SECTIONS = \[([\s\S]*?)\n\];/);
    expect(block, "SECTIONS not found in app.jsx").toBeTruthy();
    expect([...block[1].matchAll(/key: "([a-z]+)"/g)].map((m) => m[1])).toEqual(SECTION_KEYS);
  });

  it("the account function accepts the same sections", () => {
    const fn = read("supabase", "functions", "admin-users", "index.ts").match(/const ALL = \[([^\]]+)\]/);
    expect(fn, "section list not found in the edge function").toBeTruthy();
    expect(quoted(fn[1])).toEqual(SECTION_KEYS);
  });

  it("no client code still asks for the retired grants", () => {
    for (const f of SRC) {
      expect(read(f), f).not.toMatch(/access\.(documents|parties|company)|can\("documents"\)|access_documents/);
    }
  });
});
