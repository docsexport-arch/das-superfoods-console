// The Parties page has two views (decisions/018): party creation, and — behind
// "View or Edit party" — every party on file, under International and
// Private label / India. Class prevented: a created party that cannot be found
// again; a party listed under the wrong kind; the list creeping back onto the
// creation screen; a party with no way to edit or remove it.
import React from "react";
import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { AppCtx, PartiesPage } from "../src/app.jsx";
import { emptyStore, partyFromRow } from "../src/lib/db.js";

const row = (id, type, name, over = {}) => partyFromRow({
  id, type, buyer_name: name, buyer_address: "", consignee_name: "", consignee_address: "", consignee_options: [], alt_buyers: [],
  country: type === "domestic" ? "India" : "Philippines", currency: type === "domestic" ? "INR" : "USD",
  shipment_term: "", payment_term: "100% Advance", conditions: "", port_of_loading: "", destination_port: "", ...over,
}, [{ id: id.replace(/^./, "9"), name: "Peanut Butter", hsn: "2008", rate: 1, mrp: 1, net_wt: 1, gross_wt: 1, packs_per_box: 1, weight_per_pack_g: 0 }]);

const crosschannel = row("11111111-1111-4111-8111-111111111111", "international", "CROSSCHANNEL IMPORTS INC.", { alt_buyers: [{ name: "South East Asia Retail INC.", address: "" }] });
const rawabi = row("22222222-2222-4222-8222-222222222222", "international", "Al Rawabi General Trading LLC");
const mrk = row("33333333-3333-4333-8333-333333333333", "domestic", "MRK Foods Pvt Ltd");

const admin = { id: "u1", name: "Sai Admin", email: "docs.export@dasfoodindia.com", role: "admin", active: true, sections: [] };
const draw = (node, parties = [crosschannel, rawabi, mrk]) => renderToString(
  <AppCtx.Provider value={{
    store: { ...emptyStore(), parties, users: [admin] }, user: admin, loading: false, refresh: async () => {}, isAdmin: true, can: () => true,
  }}>{node}</AppCtx.Provider>).replace(/<!-- -->/g, "");
const section = (html, title) => {
  const at = html.indexOf(`<section class="mb-8" aria-label="${title}">`);
  return at < 0 ? "" : html.slice(at, html.indexOf("</section>", at));
};

describe("party creation — what the Parties page opens on", () => {
  const html = draw(<PartiesPage />);

  it("has View or Edit party at the top, saying how many are on file", () => {
    expect(html).toMatch(/<button[^>]*>View or Edit party<span[^>]*aria-label="3 on file"[^>]*>3<\/span><\/button>/);
    // It comes before the form: at the top, under the toolbar.
    expect(html.indexOf("View or Edit party")).toBeLessThan(html.indexOf("New international party"));
  });

  it("shows the creation form, open, for the kind of party picked", () => {
    for (const s of ["International", "Private label / India", "New international party", "Buyer name", "Create party"]) expect(html, s).toContain(s);
  });

  it("the form is cleared, not closed — there is nothing behind it to go back to", () => {
    expect(html).toContain("Clear form");
    expect(html).not.toMatch(/<button[^>]*aria-label="Close"/);
  });

  it("does not list the created parties", () => {
    for (const name of ["CROSSCHANNEL IMPORTS INC.", "Al Rawabi General Trading LLC", "MRK Foods Pvt Ltd", "South East Asia Retail INC."]) {
      expect(html, name).not.toContain(name);
    }
    expect(html).not.toContain("<table class=\"w-full\"><thead class=\"bg-[var(--panel)]\">");
    expect(html).not.toContain("Retire");
  });

  it("with nothing on file yet, the button still leads somewhere and says so", () => {
    expect(draw(<PartiesPage />, [])).toMatch(/aria-label="0 on file"/);
  });
});

describe("View or Edit party — every party on file", () => {
  const html = draw(<PartiesPage initialView="list" />);
  const intl = section(html, "International"), pl = section(html, "Private label / India");

  it("is headed as such, with a way back to creating one", () => {
    expect(html).toContain("View or edit parties");
    expect(html).toContain("Add party");
    expect(html).toContain("Excel");
    // The creation form is not open here.
    expect(html).not.toContain("New international party");
    expect(html).not.toContain("Create party");
  });

  it("has a section for each kind, International first", () => {
    expect(intl).not.toBe("");
    expect(pl).not.toBe("");
    expect(html.indexOf('aria-label="International"')).toBeLessThan(html.indexOf('aria-label="Private label / India"'));
  });

  it("lists every party, each under its own kind and nowhere else", () => {
    for (const name of ["CROSSCHANNEL IMPORTS INC.", "Al Rawabi General Trading LLC"]) {
      expect(intl, name).toContain(name);
      expect(pl, name).not.toContain(name);
    }
    expect(pl).toContain("MRK Foods Pvt Ltd");
    expect(intl).not.toContain("MRK Foods Pvt Ltd");
    // Nobody is left out: three parties, three rows.
    expect((html.match(/aria-label="Edit [^"]+"/g) || [])).toHaveLength(3);
  });

  it("shows how many are in each section, and a party's other names", () => {
    expect(intl).toMatch(/International <span[^>]*>2<\/span>/);
    expect(pl).toMatch(/Private label \/ India <span[^>]*>1<\/span>/);
    expect(intl).toContain("Other names: South East Asia Retail INC.");
  });

  it("every party can be edited and deleted from here", () => {
    for (const name of ["CROSSCHANNEL IMPORTS INC.", "Al Rawabi General Trading LLC", "MRK Foods Pvt Ltd"]) {
      expect(html, name).toContain(`aria-label="Edit ${name}"`);
      expect(html, name).toContain(`aria-label="Delete ${name}"`);
    }
    expect(html).toContain("Deleting retires a party from the lists");
  });

  it("a kind with no parties says so in its own section, without hiding the other", () => {
    const onlyIntl = draw(<PartiesPage initialView="list" />, [crosschannel]);
    expect(section(onlyIntl, "Private label / India")).toContain("No private-label parties yet");
    expect(section(onlyIntl, "International")).toContain("CROSSCHANNEL IMPORTS INC.");
    const none = draw(<PartiesPage initialView="list" />, []);
    expect(section(none, "International")).toContain("No international parties yet");
    expect(section(none, "Private label / India")).toContain("No private-label parties yet");
  });
});
