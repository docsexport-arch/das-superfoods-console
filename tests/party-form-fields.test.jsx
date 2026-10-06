// The party form after decisions/014: "Ship to" and "Shipping address", no
// ports, and no INR for an international party — with the ports typed on the
// proforma instead. Class prevented: a field taken off one form that nothing
// can enter any more; a value left behind on the party and used unseen; a
// party's currency changing just because it was opened.
import React from "react";
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToString } from "react-dom/server";
import { AppCtx, PartyForm, ProformaForm, ProformaDocument } from "../src/app.jsx";
import { emptyStore, partyFromRow, proformaFromRow, draftFromRow } from "../src/lib/db.js";
import { proformaSheetRows } from "../src/lib/documents.js";
import { PARTY_KEYS, PROFORMA_KEYS } from "../src/lib/payloads.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const appSource = readFileSync(join(ROOT, "src", "app.jsx"), "utf8");

const product = { id: "11111111-1111-4111-8111-111111111111", name: "Peanut Butter Creamy 340g", hsn: "20081100", rate: 17.77, mrp: 1500, net_wt: 1.36, gross_wt: 1.52, packs_per_box: 6, weight_per_pack_g: 0 };
const partyRow = (over = {}) => ({
  id: "22222222-2222-4222-8222-222222222222", type: "international",
  buyer_name: "Crosschannel Imports Inc.", buyer_address: "Newark, NJ", consignee_name: "Crosschannel Logistics", consignee_address: "Port Newark",
  consignee_options: [], alt_buyers: [], country: "United States", currency: "USD", shipment_term: "FOB", payment_term: "30% advance",
  conditions: "", port_of_loading: "", destination_port: "", ...over,
});
const fresh = partyFromRow(partyRow(), [product]);                                                    // made after the change: no ports
const older = partyFromRow(partyRow({ port_of_loading: "Mundra", destination_port: "New York" }), [product]);   // made before it
const domestic = partyFromRow(partyRow({ id: "33333333-3333-4333-8333-333333333333", type: "domestic", buyer_name: "Private Label Co", country: "India", currency: "INR" }), [product]);

const admin = { id: "u1", name: "Sai Admin", email: "docs.export@dasfoodindia.com", role: "admin", active: true, sections: [] };
const draw = (node, parties = []) => renderToString(
  <AppCtx.Provider value={{
    store: { ...emptyStore(), parties, users: [admin] }, user: admin, loading: false, refresh: async () => {}, isAdmin: true, can: () => true,
  }}>{node}</AppCtx.Provider>).replace(/<!-- -->/g, "");
const labels = (html) => [...html.matchAll(/<label[^>]*><span[^>]*>([^<]*)<\/span>/g)].map((m) => m[1]);
const field = (html, label) => {
  const at = html.indexOf(`>${label}</span>`);
  return at < 0 ? "" : html.slice(at, html.indexOf("</label>", at));
};
const partyForm = (tab, initial) => draw(<PartyForm tab={tab} initial={initial} onSave={() => {}} onCancel={() => {}} />);
const proformaForm = (type, parties, props = {}) => draw(<ProformaForm type={type} onSave={() => {}} onSaveDraft={() => {}} onCancel={() => {}} {...props} />, parties);

describe("the party form", () => {
  it("says Ship to and Shipping address, not consignee", () => {
    const names = labels(partyForm("international"));
    expect(names).toContain("Ship to");
    expect(names).toContain("Shipping address");
    expect(names).not.toContain("Consignee name");
    expect(names).not.toContain("Consignee address");
  });

  it("shows what was saved as the consignee in the Ship to boxes — a new label, the same data", () => {
    const html = partyForm("international", older);
    expect(field(html, "Ship to")).toContain('value="Crosschannel Logistics"');
    expect(field(html, "Shipping address")).toContain('value="Port Newark"');
    for (const k of ["consigneeName", "consigneeAddress"]) expect(PARTY_KEYS).toContain(k);
  });

  it("has no port of loading and no destination port, for either kind of party", () => {
    for (const html of [partyForm("international"), partyForm("international", older), partyForm("domestic")]) {
      expect(labels(html)).not.toContain("Port of loading");
      expect(labels(html)).not.toContain("Destination port");
      // Not hidden in a box under another name either.
      expect(html).not.toContain('value="Mundra"');
    }
    expect(appSource).not.toMatch(/set\("portOfLoading"|set\("destinationPort"/);
  });

  it("an international party is offered USD only", () => {
    const currency = field(partyForm("international"), "Currency");
    expect(currency).toMatch(/<option[^>]*value="USD"[^>]*selected=""/);
    expect(currency).not.toContain("INR");
  });

  it("a private-label / India party still has INR, and starts on it", () => {
    expect(field(partyForm("domestic"), "Currency")).toMatch(/<option[^>]*value="INR"[^>]*selected=""/);
  });

  it("a party already saved in INR keeps it when opened — its currency is not changed unasked", () => {
    const inr = partyFromRow(partyRow({ currency: "INR" }), [product]);
    const currency = field(partyForm("international", inr), "Currency");
    expect(currency).toMatch(/<option[^>]*value="INR"[^>]*selected=""/);
    expect(currency).toContain('value="USD"');
  });

  it("the party list no longer exports ports", () => {
    expect(appSource).not.toMatch(/r\.p\.portOfLoading|r\.p\.destinationPort/);
  });
});

describe("ports are typed on the proforma instead", () => {
  it("an international proforma has both boxes, and sends what is typed", () => {
    const names = labels(proformaForm("international", [fresh]));
    expect(names).toContain("Port of loading");
    expect(names).toContain("Destination port");
    for (const k of ["portOfLoading", "destinationPort"]) expect(PROFORMA_KEYS).toContain(k);
    // What is saved is what is in the boxes — never read off the party behind the form's back.
    expect(appSource).not.toMatch(/portOfLoading: party\.portOfLoading/);
    expect(appSource).toMatch(/portOfLoading: isIntl \? portOfLoading\.trim\(\) : ""/);
  });

  it("the boxes start empty for a party that has no ports", () => {
    const html = proformaForm("international", [fresh]);
    expect(field(html, "Port of loading")).toContain('value=""');
    expect(field(html, "Destination port")).toContain('value=""');
  });

  it("a party saved before the change offers its old ports in the boxes, where they can be seen and changed", () => {
    const html = proformaForm("international", [older]);
    expect(field(html, "Port of loading")).toContain('value="Mundra"');
    expect(field(html, "Destination port")).toContain('value="New York"');
  });

  it("a private-label proforma has no port boxes", () => {
    const names = labels(proformaForm("domestic", [domestic]));
    expect(names).not.toContain("Port of loading");
    expect(names).not.toContain("Destination port");
  });

  it("a draft brings back the ports that were typed, not the party's", () => {
    const draft = draftFromRow({ id: "d1", kind: "proforma", title: "t", saved_by: "x", updated_at: "2026-10-06T06:40:00Z",
      payload: { type: "international", partyId: older.id, items: [], portOfLoading: "Nhava Sheva", destinationPort: "Savannah" } });
    const html = proformaForm("international", [older], { draft });
    expect(field(html, "Port of loading")).toContain('value="Nhava Sheva"');
    expect(field(html, "Destination port")).toContain('value="Savannah"');
  });

  it("editing a proforma shows the ports it was raised with — blank stays blank", () => {
    const row = (over) => proformaFromRow({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", doc_no: "PI/25-26/014", doc_date: "2026-10-05", type: "international", party_id: older.id,
      buyer_name: "Crosschannel Imports Inc.", buyer_address: "Newark, NJ", consignee_name: "Crosschannel Logistics", consignee_address: "Port Newark",
      consignee_options: [], shipment_term: "FOB", payment_term: "30% advance", conditions: "", currency: "USD", order_no: "", order_date: "2026-10-01",
      additional_details: "", total_boxes: 1, total_value: 1, taxable_value: 0, tax_rate: 0, tax_amount: 0, grand_total: 1, items: [],
      shipment_id: null, updated_at: "2026-10-05T11:53:08+00:00", ...over,
    });
    const withPorts = proformaForm("international", [older], { editing: row({ port_of_loading: "Kandla", destination_port: "Houston" }) });
    expect(field(withPorts, "Port of loading")).toContain('value="Kandla"');
    expect(field(withPorts, "Destination port")).toContain('value="Houston"');
    // Raised with no ports: the party's old pair must not creep in on edit.
    const without = proformaForm("international", [older], { editing: row({ port_of_loading: "", destination_port: "" }) });
    expect(field(without, "Port of loading")).toContain('value=""');
    expect(field(without, "Destination port")).toContain('value=""');
  });
});

describe("the proforma document", () => {
  const pi = (over = {}) => ({
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", docNo: "PI/25-26/014", date: "2026-10-05", type: "international",
    buyerName: "Crosschannel Imports Inc.", buyerAddress: "Newark, NJ", consigneeName: "Crosschannel Logistics", consigneeAddress: "Port Newark",
    currency: "USD", shipmentTerm: "FOB", paymentTerm: "30% advance", conditions: "", totalBoxes: 10, totalValue: 177.7, grandTotal: 177.7,
    portOfLoading: "", destinationPort: "", items: [{ id: "l1", name: "Peanut Butter Creamy 340g", hsn: "20081100", boxQty: 10, rate: 17.77, packsPerBox: 6 }], ...over,
  });

  it("prints the ports when the proforma has them", () => {
    const html = draw(<ProformaDocument pi={pi({ portOfLoading: "Mundra", destinationPort: "New York" })} company={{}} />);
    expect(html).toContain("Loading: Mundra");
    expect(html).toContain("Destination: New York");
    expect(proformaSheetRows(pi({ portOfLoading: "Mundra", destinationPort: "New York" }), {}))
      .toContainEqual(["Port of loading", "Mundra", "", "Destination port", "New York"]);
  });

  it("says nothing about ports when there are none, instead of printing dashes", () => {
    const html = draw(<ProformaDocument pi={pi()} company={{}} />);
    expect(html).not.toContain("Loading:");
    expect(html).not.toContain("Destination:");
    expect(html).toContain("Shipment: FOB");
    expect(proformaSheetRows(pi(), {}).some((r) => r[0] === "Port of loading")).toBe(false);
  });

  it("with only one of the two, shows it and marks the other as missing", () => {
    const html = draw(<ProformaDocument pi={pi({ portOfLoading: "Mundra" })} company={{}} />);
    expect(html).toContain("Loading: Mundra");
    expect(html).toContain("Destination: —");
  });
});
