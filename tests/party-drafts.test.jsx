// Party drafts (db/017, decisions/019). Class prevented: a half-filled party
// that is lost; a draft that comes back with boxes missing; a draft shown as
// if it were a party, or a party still listed as a draft; a draft readable by
// a section that has nothing to do with parties.
import React from "react";
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToString } from "react-dom/server";
import { AppCtx, PartiesPage, PartyForm } from "../src/app.jsx";
import { emptyStore, partyFromRow, draftFromRow } from "../src/lib/db.js";
import { DRAFT_KEYS, pick } from "../src/lib/payloads.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const sql = readFileSync(join(ROOT, "db", "017_party_drafts.sql"), "utf8").replace(/\r\n/g, "\n");
const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const fn = (name) => new RegExp("create or replace function public\\." + name + "\\([\\s\\S]*?\\n\\$\\$;").exec(sql)[0];
const appSource = readFileSync(join(ROOT, "src", "app.jsx"), "utf8");
const dbSource = readFileSync(join(ROOT, "src", "lib", "db.js"), "utf8");

const created = partyFromRow({
  id: "11111111-1111-4111-8111-111111111111", type: "international", buyer_name: "CROSSCHANNEL IMPORTS INC.", buyer_address: "", consignee_name: "",
  consignee_address: "", consignee_options: [], alt_buyers: [], country: "Philippines", currency: "USD", shipment_term: "", payment_term: "", conditions: "",
}, []);
// What the form hands to "Save draft": its own state, exactly as it stands.
const formState = {
  tab: "domestic",
  f: { type: "domestic", buyerName: "MRK Foods Pvt Ltd", buyerAddress: "Bhandup, Mumbai", consigneeName: "MRK Warehouse", consigneeAddress: "Bhiwandi",
    country: "India", currency: "INR", shipmentTerm: "Ex- Factory", paymentTerm: "50% advance", conditions: "", portOfLoading: "", destinationPort: "",
    consigneeOptions: [], altBuyers: [{ name: "MRK Retail LLP", address: "Thane" }] },
  products: [{ id: "tmp1", name: "Private Label PB 1kg", hsn: "20081100", rate: 0, mrp: 1500, netWtG: "12000", grossWtG: "12850", packsPerBox: 12, weightPerPackG: 0 }],
  conditions: ["Goods once sold will not be taken back", "Subject to Mumbai jurisdiction"],
};
const draft = draftFromRow({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", kind: "party", title: "MRK Foods Pvt Ltd · Private label / India", ref_id: null,
  saved_by: "ecom02@pintola.in", updated_at: "2026-10-07T06:40:00Z", payload: formState });
const intlDraft = draftFromRow({ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", kind: "party", title: "Untitled party · International", ref_id: null,
  saved_by: "docs.export@dasfoodindia.com", updated_at: "2026-10-07T07:00:00Z", payload: { tab: "international", f: { buyerName: "" }, products: [], conditions: [""] } });
const proformaDraft = draftFromRow({ id: "ffffffff-ffff-4fff-8fff-ffffffffffff", kind: "proforma", title: "A proforma draft", saved_by: "x", updated_at: "2026-10-07T07:00:00Z", payload: {} });

const admin = { id: "u1", name: "Sai Admin", email: "docs.export@dasfoodindia.com", role: "admin", active: true, sections: [] };
const draw = (node, extra = {}) => renderToString(
  <AppCtx.Provider value={{
    store: { ...emptyStore(), parties: [created], users: [admin], ...extra }, user: admin, loading: false, refresh: async () => {}, isAdmin: true, can: () => true,
  }}>{node}</AppCtx.Provider>).replace(/<!-- -->/g, "");
const field = (html, label) => {
  const at = html.indexOf(`>${label}</span>`);
  return at < 0 ? "" : html.slice(at, html.indexOf("</label>", at));
};

describe("the creation form can be saved part-way", () => {
  it("offers Save draft on both kinds of party, beside Create", () => {
    for (const tab of ["international", "domestic"]) {
      const html = draw(<PartyForm tab={tab} onSave={() => {}} onSaveDraft={() => {}} onCancel={() => {}} />);
      expect(html, tab).toContain("Save draft");
      expect(html, tab).toContain("Create party");
    }
  });

  it("an existing party being edited has no Save draft — it is already a party", () => {
    const html = draw(<PartiesPage initialView="list" />);
    expect(html).not.toContain("Save draft");
    expect(draw(<PartyForm tab="international" initial={created} onSave={() => {}} onCancel={() => {}} />)).not.toContain("Save draft");
  });

  it("a draft is the form's own state: the boxes, the product rows with grams, the list of conditions", () => {
    expect(appSource).toMatch(/payload: \{ tab, f, products, conditions \}/);
    const sent = pick({ kind: "party", title: "t", payload: formState, id: undefined, expectedUpdatedAt: undefined }, DRAFT_KEYS);
    expect(Object.keys(sent).sort()).toEqual(["kind", "payload", "title"]);
    expect(sent.payload).toBe(formState);
  });
});

describe("continuing a party draft", () => {
  const html = draw(<PartyForm tab="domestic" draft={draft} onSave={() => {}} onSaveDraft={() => {}} onCancel={() => {}} />);

  it("says whose draft it is", () => {
    expect(html).toContain("Draft private-label party");
    expect(html).toContain("Continuing the draft saved by ecom02@pintola.in");
  });

  it("brings back every box as it was left", () => {
    expect(field(html, "Buyer name")).toContain('value="MRK Foods Pvt Ltd"');
    expect(field(html, "Buyer address")).toContain('value="Bhandup, Mumbai"');
    expect(field(html, "Ship to")).toContain('value="MRK Warehouse"');
    expect(field(html, "Shipping address")).toContain('value="Bhiwandi"');
    expect(field(html, "Payment term")).toContain('value="50% advance"');
    expect(field(html, "Currency")).toMatch(/<option[^>]*value="INR"[^>]*selected=""/);
  });

  it("brings back the other names, the conditions and the product rows — weights still in grams", () => {
    for (const v of ["MRK Retail LLP", "Thane", "Goods once sold will not be taken back", "Subject to Mumbai jurisdiction", "Private Label PB 1kg"]) {
      expect(html, v).toContain(`value="${v}"`);
    }
    expect(html).toContain("Condition 2");
    // This draft was saved before a weight unit could be chosen: it holds grams.
    expect(html).toMatch(/aria-label="Net weight per box"[^>]*value="12000"/);
    expect(html).toMatch(/aria-label="Gross weight per box"[^>]*value="12850"/);
    expect(html).toMatch(/aria-label="Box weight unit"[^>]*>[\s\S]*?<option value="g" selected="">g<\/option>/);
  });

  it("a draft with almost nothing in it still opens, with the usual empty boxes", () => {
    const bare = draw(<PartyForm tab="international" draft={intlDraft} onSave={() => {}} onSaveDraft={() => {}} onCancel={() => {}} />);
    expect(bare).toContain("Draft international party");
    expect(field(bare, "Buyer name")).toContain('value=""');
    expect(field(bare, "Currency")).toMatch(/<option[^>]*value="USD"[^>]*selected=""/);
    expect(bare).toContain("Condition 1");
    const junk = draftFromRow({ id: "j", kind: "party", title: "j", payload: { f: "not an object", products: "x", conditions: [] } });
    expect(draw(<PartyForm tab="international" draft={junk} onSave={() => {}} onSaveDraft={() => {}} onCancel={() => {}} />)).toContain("Condition 1");
  });
});

describe("the party creation screen lists only what is not a party yet", () => {
  const html = draw(<PartiesPage />, { drafts: [draft, intlDraft, proformaDraft] });
  const list = html.slice(html.indexOf("Draft parties"));

  it("lists the party drafts, with who saved each and when, and Continue and Discard", () => {
    expect(html).toContain("Draft parties");
    for (const s of ["MRK Foods Pvt Ltd · Private label / India", "Untitled party · International", "ecom02@pintola.in", "07/10/2026", "Continue draft", "Discard"]) {
      expect(list, s).toContain(s);
    }
    expect(list).toContain("Once a party is created it leaves this list and appears under View or Edit party.");
  });

  it("does not list created parties there, nor another section's drafts", () => {
    expect(html).not.toContain("CROSSCHANNEL IMPORTS INC.");
    expect(html).not.toContain("A proforma draft");
  });

  it("the count on View or Edit party is of created parties only — drafts do not count", () => {
    expect(html).toMatch(/aria-label="1 on file"/);
  });

  it("with no drafts there is no drafts panel", () => {
    expect(draw(<PartiesPage />)).not.toContain("Draft parties");
  });

  it("the list of created parties never shows a draft", () => {
    const view = draw(<PartiesPage initialView="list" />, { drafts: [draft, intlDraft] });
    expect(view).toContain("CROSSCHANNEL IMPORTS INC.");
    expect(view).not.toContain("MRK Foods Pvt Ltd");
    expect(view).not.toContain("Draft parties");
    expect((view.match(/aria-label="Edit [^"]+"/g) || [])).toHaveLength(1);
  });
});

describe("what the page does with a draft", () => {
  it("creating from a draft creates the party and retires the draft in one call", () => {
    expect(appSource).toMatch(/if \(formDraft\) await call\("raise_from_draft", \{ p_draft: formDraft\.id, p: body \}\);\s+else await call\("save_party", \{ p: body \}\);/);
  });

  it("saving again continues the same draft, from the version that was opened", () => {
    expect(appSource).toMatch(/kind: "party", title, payload,\s+id: formDraft \? formDraft\.id : undefined, expectedUpdatedAt: formDraft \? formDraft\.updatedAt : undefined,/);
  });

  it("drafts are loaded for someone who holds only Parties", () => {
    expect(dbSource).toMatch(/if \(can\.parties \|\| can\.proforma \|\| can\.shipments\) \{\s+jobs\.push\(readAll\("drafts"/);
  });
});

describe("party drafts in the database", () => {
  it("are a third kind of draft, read by the parties grant and no other", () => {
    expect(code).toMatch(/check \(kind in \('party', 'proforma', 'shipment'\)\)/);
    expect(code).toMatch(/\(kind = 'party'\s+and public\.has_access\('parties'\)\)/);
    expect(code).not.toMatch(/grant\s+(all|insert|update|delete)[^;]*public\.drafts/i);
    expect(code).not.toMatch(/create policy[^;]*on public\.drafts for (all|insert|update|delete)/i);
  });

  it("every draft function sends a party draft to the parties grant", () => {
    for (const name of ["save_draft", "delete_draft", "raise_from_draft"]) {
      expect(fn(name), name).toContain("when 'party' then 'parties'");
      // The old two-way mapping would have treated a party draft as a shipment's.
      expect(fn(name), name).not.toMatch(/when 'proforma' then 'proforma' else 'shipments' end/);
    }
  });

  it("the party is created by the function that creates any party, and can only be created", () => {
    const raise = fn("raise_from_draft");
    expect(raise).toContain("public.save_party(p - 'id')");
    expect(raise).toContain("public.save_proforma(p - 'id' - 'expectedUpdatedAt')");
    expect(raise).toContain("public.save_shipment(p - 'id' - 'expectedUpdatedAt')");
    expect(raise).not.toMatch(/insert into public\.parties|update public\.parties/);
  });
});
