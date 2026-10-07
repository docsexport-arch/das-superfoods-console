// Back to the page you were on (decisions/022). The place is kept in the
// address bar and the browser's history. Class prevented: a Back that leaves
// the console; a Back that lands on a section the address does not name; an
// in-page anchor being mistaken for a move; a screen reached by Back still
// showing what the other screen left behind.
import React from "react";
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToString } from "react-dom/server";
import { AppCtx, PartiesPage } from "../src/app.jsx";
import { emptyStore, partyFromRow, SECTION_KEYS } from "../src/lib/db.js";
import { parseRoute, routeHash, sameRoute } from "../src/lib/route.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const appSource = readFileSync(join(ROOT, "src", "app.jsx"), "utf8");
const routeSource = readFileSync(join(ROOT, "src", "lib", "route.js"), "utf8");

describe("the address says where you are", () => {
  it("reads a section, and a view inside it", () => {
    expect(parseRoute("#/parties")).toEqual({ section: "parties", view: "" });
    expect(parseRoute("#/parties/list")).toEqual({ section: "parties", view: "list" });
    expect(parseRoute("#/proforma/")).toEqual({ section: "proforma", view: "" });
  });

  it("writes the same address back", () => {
    expect(routeHash({ section: "parties", view: "list" })).toBe("#/parties/list");
    expect(routeHash({ section: "shipments" })).toBe("#/shipments");
    for (const section of SECTION_KEYS) expect(parseRoute(routeHash({ section, view: "" }))).toEqual({ section, view: "" });
    expect(parseRoute(routeHash({ section: "parties", view: "list" }))).toEqual({ section: "parties", view: "list" });
  });

  it("an address that is not a place is not a move — the skip link's #main, or nothing at all", () => {
    for (const hash of ["", "#", "#main", "main", "#/", null, undefined]) expect(parseRoute(hash), String(hash)).toBeNull();
  });

  it("keeps only plain words, so nothing odd in an address reaches the page", () => {
    expect(parseRoute("#/Parties/LIST")).toEqual({ section: "parties", view: "list" });
    expect(parseRoute("#/par<ties>/li st")).toEqual({ section: "parties", view: "list" });
    expect(routeHash({ section: "pro forma", view: "../x" })).toBe("#/proforma/x");
  });

  it("knows when two addresses are the same place", () => {
    expect(sameRoute({ section: "parties", view: "" }, { section: "parties" })).toBe(true);
    expect(sameRoute({ section: "parties", view: "list" }, { section: "parties", view: "" })).toBe(false);
    expect(sameRoute(null, { section: "parties" })).toBe(false);
  });
});

describe("moving, and going back", () => {
  it("every move adds one numbered entry to the browser's history; staying put adds none", () => {
    expect(routeSource).toMatch(/if \(!next\.section \|\| sameRoute\(here, next\)\) return;/);
    expect(routeSource).toMatch(/window\.history\.pushState\(\{ idx: next\.idx \}, "", routeHash\(next\)\);/);
    expect(routeSource).toMatch(/idx: here\.idx \+ 1/);
  });

  it("Back is the browser's own back — so the browser's arrows and the console's button agree", () => {
    expect(routeSource).toMatch(/window\.history\.back\(\)/);
    expect(routeSource).toMatch(/window\.addEventListener\("popstate", onPop\)/);
  });

  it("the console's Back can never leave the console: it works only while there is an earlier page of it", () => {
    expect(routeSource).toMatch(/const goBack = useCallback\(\(\) => \{ if \(routeRef\.current\.idx > 0\) window\.history\.back\(\); \}, \[\]\);/);
    expect(routeSource).toMatch(/canGoBack: route\.idx > 0/);
    // The page it was opened on is numbered 0 without adding an entry.
    expect(routeSource).toMatch(/window\.history\.replaceState\(\{ \.\.\.\(state \|\| \{\}\), idx: 0 \}/);
  });

  it("an in-page anchor fires the same event as Back and must be ignored", () => {
    expect(routeSource).toMatch(/const place = parseRoute\(window\.location\.hash\);\s+if \(!place\) return;/);
  });
});

describe("the console is wired to it", () => {
  it("the section showing comes from the address, and every way of changing section goes through navigate", () => {
    expect(appSource).toMatch(/const \{ route, navigate, goBack, canGoBack \} = useRoute\("overview"\);/);
    expect(appSource).toMatch(/const active = route\.section;/);
    expect(appSource).toMatch(/const setActive = \(section\) => navigate\(section\);/);
    // No second, private record of which section is showing.
    expect(appSource).not.toMatch(/const \[active, setActive\] = useState/);
  });

  it("a Back button sits above every page, in one place, and is switched off when there is nowhere to go", () => {
    const at = appSource.indexOf('aria-label="Back to the previous page"');
    expect(at).toBeGreaterThan(-1);
    expect(appSource.slice(at - 60, at)).toContain("onClick={goBack} disabled={!canGoBack}");
    // It is in the shell, before the pages are chosen — not inside any one page.
    expect(at).toBeLessThan(appSource.indexOf('current.key === "overview" && <Overview'));
    expect(appSource.slice(at, at + 900)).toMatch(/<ArrowLeft className="h-4 w-4" \/> Back/);
    expect((appSource.match(/aria-label="Back to the previous page"/g) || [])).toHaveLength(1);
  });

  it("an address for a section the account does not hold falls back to one it does", () => {
    expect(appSource).toMatch(/const current = sections\.find\(\(s\) => s\.key === active\) \|\| sections\[0\];/);
  });

  it("pages are handed the place and the way to move", () => {
    expect(appSource).toMatch(/loading, route, navigate \};/);
  });
});

describe("Parties: its two screens are places", () => {
  const party = partyFromRow({ id: "11111111-1111-4111-8111-111111111111", type: "international", buyer_name: "CROSSCHANNEL IMPORTS INC.", buyer_address: "", consignee_name: "",
    consignee_address: "", consignee_options: [], alt_buyers: [], country: "Philippines", currency: "USD", shipment_term: "", payment_term: "", conditions: "" }, []);
  const admin = { id: "u1", name: "Sai Admin", email: "docs.export@dasfoodindia.com", role: "admin", active: true, sections: [] };
  const drawAt = (view) => renderToString(
    <AppCtx.Provider value={{ store: { ...emptyStore(), parties: [party], users: [admin] }, user: admin, loading: false, refresh: async () => {}, isAdmin: true, can: () => true,
      route: { section: "parties", view }, navigate: () => {} }}>
      <PartiesPage />
    </AppCtx.Provider>).replace(/<!-- -->/g, "");

  it("#/parties is party creation", () => {
    const html = drawAt("");
    expect(html).toContain("New international party");
    expect(html).toContain("View or Edit party");
    expect(html).not.toContain("CROSSCHANNEL IMPORTS INC.");
  });

  it("#/parties/list is View or Edit party — so Back from it returns to creation", () => {
    const html = drawAt("list");
    expect(html).toContain("View or edit parties");
    expect(html).toContain("CROSSCHANNEL IMPORTS INC.");
    expect(html).not.toContain("New international party");
  });

  it("an unknown view is treated as party creation, not an empty page", () => {
    expect(drawAt("whatever")).toContain("New international party");
  });

  it("inside the console the address decides — the page's own starting choice is not used", () => {
    const html = renderToString(
      <AppCtx.Provider value={{ store: { ...emptyStore(), parties: [party], users: [admin] }, user: admin, loading: false, refresh: async () => {}, isAdmin: true, can: () => true,
        route: { section: "parties", view: "" }, navigate: () => {} }}>
        <PartiesPage initialView="list" />
      </AppCtx.Provider>).replace(/<!-- -->/g, "");
    expect(html).toContain("New international party");
    expect(html).not.toContain("View or edit parties");
  });

  it("switching screens goes through navigate, so it lands in the history", () => {
    expect(appSource).toMatch(/const setView = \(next\) => \(routed \? navigate\("parties", next === "list" \? "list" : ""\) : setLocalView\(next\)\);/);
  });

  it("a screen reached by Back starts clean — no half-open edit or message from the other screen", () => {
    expect(appSource).toMatch(/arrivedAt\.current = view;\s+setEditingId\(null\); setConfirmId\(null\); setSaveError\(""\); setNotice\(""\);/);
  });
});
