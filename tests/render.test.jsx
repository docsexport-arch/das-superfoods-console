// Draws every screen and form against sample data, as an admin, as staff, and
// against an empty database. Class prevented: a screen that throws while
// rendering (an undefined name, a missing field) — which no unit test of the
// libraries can see, and which would otherwise only be found by a user.
import React from "react";
import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import {
  AppCtx, SignIn, Overview, PartiesPage, PartyForm, QuotationsPage, QuotationForm, QuotationDocument,
  ProformaPage, ProformaForm, ShipmentsPage, ShipmentForm, AnalyticsPage, CompanyPage, UsersPage,
} from "../src/app.jsx";
import { emptyStore } from "../src/lib/db.js";

const product = { id: "11111111-1111-4111-8111-111111111111", name: "Peanut Butter Creamy 340g", hsn: "20081100", rate: 1.85, mrp: 0, netWt: 0.35, grossWt: 0.41, packsPerBox: 12, weightPerPackG: 340 };
const party = {
  id: "22222222-2222-4222-8222-222222222222", type: "international",
  buyerName: "Al Rawabi General Trading LLC", buyerAddress: "Al Quoz, Dubai", consigneeName: "Al Rawabi FZE",
  consigneeAddress: "Jebel Ali", consigneeOptions: ["Al Rawabi FZE"], country: "United Arab Emirates", currency: "USD",
  shipmentTerm: "CIF", paymentTerm: "30% advance", conditions: "", portOfLoading: "Mundra", destinationPort: "Jebel Ali",
  products: [product],
};
const line = { id: "l1", productId: product.id, name: product.name, hsn: product.hsn, boxQty: 1200, rate: 1.85, mrp: 0, netWt: 0.35, grossWt: 0.41, packsPerBox: 12 };
const quotation = {
  id: "q1", docNo: "DS-QUO-2026-0001", date: "2026-10-03", partyId: party.id, buyerName: party.buyerName, buyerAddress: "Dubai",
  country: "United Arab Emirates", shipmentTerm: "CIF", paymentTerm: "30% advance", igst: false, igstRate: 0,
  totalValue: 2220, igstAmt: 0, grandTotal: 2220, updatedAt: "2026-10-03T05:10:10+00:00",
  items: [{ id: "i1", product: product.name, hsn: product.hsn, boxQty: 1200, boxRate: 1.85 }],
};
const proforma = {
  id: "p1", docNo: "DS-PI-INTL-2026-0001", date: "2026-10-03", type: "international", partyId: party.id,
  buyerName: party.buyerName, buyerAddress: "Dubai", consigneeName: "Al Rawabi FZE", consigneeAddress: "Jebel Ali",
  consigneeOptions: ["Al Rawabi FZE"], portOfLoading: "Mundra", destinationPort: "Jebel Ali", shipmentTerm: "CIF",
  paymentTerm: "30% advance", conditions: "", currency: "USD", buyerOrderNo: "PO-77", buyerOrderDate: "2026-10-01",
  totalBoxes: 1200, totalValue: 2220, taxableValue: 0, taxRate: 0, taxAmount: 0, grandTotal: 2220,
  items: [line], linkedFinalInvoiceId: null,
};
const shipment = {
  id: "s1", docNo: "DS-INV-2026-0001", taxDocNo: "DS-INV-2026-0001-TAX", commercialDocNo: "DS-INV-2026-0001-COM",
  date: "2026-10-03", piId: "p0", piNo: "DS-PI-INTL-2026-0000", buyerName: party.buyerName, exchangeRate: 83,
  containerNo: "MSKU1234567", lineSeal: "SL-9", incoterm: "CIF",
  taxInvoice: { consignee: "TO THE ORDER", currency: "INR", total: 184260, gst: 9213, roundOff: 0, grandTotal: 193473 },
  commercialInvoice: { consignee: "Al Rawabi FZE", currency: "USD", total: 2220 },
  packingList: { totalBoxes: 1200, totalPacks: 14400, netWeight: 420, grossWeight: 492, grandTotal: 912 },
  company: { name: "Das Superfoods Pvt. Ltd.", bankName: "HDFC Bank", accountNo: "5020" }, items: [line],
};
const admin = { id: "u1", name: "Sai Admin", email: "docs.export@dasfoodindia.com", role: "admin", active: true, sections: ["overview", "parties", "quotations", "proforma", "shipments", "analytics", "company", "users"], lastLogin: "2026-10-03T05:10:10Z" };
const staff = { id: "u2", name: "Ecom Staff", email: "ecom02@pintola.in", role: "staff", active: true, sections: ["overview", "quotations"], lastLogin: null };

const fullStore = () => ({
  ...emptyStore(),
  company: { name: "Das Superfoods Pvt. Ltd.", address: "Ahmedabad", bankName: "HDFC Bank", accountNo: "5020", ifsc: "HDFC0000123", swift: "HDFCINBB", gstNo: "24AAAAA0000A1Z5", iecCode: "0312345678" },
  parties: [party], quotations: [quotation], pis: [proforma], finalInvoices: [shipment],
  users: [admin, staff],
  audit: [{ id: 1, at: "2026-10-03T05:10:10Z", user: admin.email, action: "Signed in", detail: "" }],
  migrationIds: [1, 2, 3, 4, 5, 6, 7, 8, 9],
});

const ctxFor = (user, store) => ({
  store, user, loading: false, refresh: async () => {},
  isAdmin: user.role === "admin",
  can: (section) => user.role === "admin" || user.sections.includes(section),
});
const draw = (node, user = admin, store = fullStore()) =>
  renderToString(<AppCtx.Provider value={ctxFor(user, store)}>{node}</AppCtx.Provider>);

describe("every screen renders", () => {
  it("sign-in offers a reset link and no public sign-up", () => {
    const html = draw(<SignIn onSignIn={async () => ""} onReset={async () => ""} />);
    expect(html).toContain("Forgotten your password?");
    expect(html).not.toContain("Create account");
  });

  it("overview", () => {
    const html = draw(<Overview onNavigate={() => {}} />);
    expect(html).toContain("DS-PI-INTL-2026-0001");
  });

  it("parties — list, Excel, add and edit forms", () => {
    expect(draw(<PartiesPage initialView="list" />)).toContain("Al Rawabi General Trading LLC");
    expect(draw(<PartiesPage initialView="list" />)).toContain("Excel");
    expect(draw(<PartyForm tab="international" onSave={() => {}} onCancel={() => {}} />)).toContain("Buyer name");
    expect(draw(<PartyForm tab="international" initial={party} onSave={() => {}} onCancel={() => {}} />)).toContain("Peanut Butter Creamy 340g");
  });

  it("quotations — PDF, Edit and Delete on every row, dates dd/mm/yyyy", () => {
    const html = draw(<QuotationsPage />);
    for (const s of ["DS-QUO-2026-0001", "PDF", "Edit", "Delete", "Excel", "03/10/2026"]) expect(html).toContain(s);
    expect(html).not.toContain("2026-10-03");
  });

  it("quotation form prefilled for an edit, and blank for a new one", () => {
    expect(draw(<QuotationForm initial={quotation} onCancel={() => {}} onSubmit={async () => ""} />)).toContain("Edit DS-QUO-2026-0001");
    expect(draw(<QuotationForm onCancel={() => {}} onSubmit={async () => ""} />)).toContain("New quotation");
  });

  it("the printable quotation carries the letterhead, buyer, lines and totals", () => {
    const html = draw(<QuotationDocument q={quotation} company={fullStore().company} />);
    for (const s of ["Das Superfoods Pvt. Ltd.", "24AAAAA0000A1Z5", "Al Rawabi General Trading LLC", "Peanut Butter Creamy 340g", "2,220.00", "03/10/2026"]) {
      expect(html).toContain(s);
    }
  });

  it("proforma — list shows boxes and units; both form types render", () => {
    const html = draw(<ProformaPage />);
    expect(html).toContain("DS-PI-INTL-2026-0001");
    expect(html).toContain("14400");
    expect(draw(<ProformaForm type="international" onSave={() => {}} onCancel={() => {}} />)).toContain("Al Rawabi General Trading LLC");
    expect(draw(<ProformaForm type="domestic" onSave={() => {}} onCancel={() => {}} />)).toContain("private-label");
  });

  it("shipments — list in INR, and the form asks for an exchange rate on a USD proforma", () => {
    const html = draw(<ShipmentsPage />);
    expect(html).toContain("DS-INV-2026-0001");
    expect(html).toContain("₹1,93,473.00");
    const form = draw(<ShipmentForm pi={proforma} onSave={async () => {}} onCancel={() => {}} error="" />);
    expect(form).toContain("Enter the exchange rate to see the INR figures.");
    expect(form).toContain("14400");
  });

  it("analytics and company", () => {
    expect(draw(<AnalyticsPage />)).toContain("phase 2");
    const companyPage = draw(<CompanyPage />);
    expect(companyPage).toContain("HDFCINBB");
    // IFSC was removed from the company profile on the owner's instruction
    // (decisions/011) — even when an old value is still on the row.
    expect(companyPage).not.toContain("HDFC0000123");
    expect(companyPage).not.toMatch(/IFSC/i);
  });

  it("users — an admin gets the add-a-user form, all eight tick-boxes, and the row actions", () => {
    const html = draw(<UsersPage />);
    for (const s of ["Add a user", "Password", "Generate", "Create user", "Set password", "ecom02@pintola.in", "Deactivate", "Excel", "Tick all"]) {
      expect(html).toContain(s);
    }
    for (const s of ["Overview", "Parties", "Quotations", "Proforma", "Shipments", "Analytics", "Company", "Users"]) {
      expect(html, `tick-box for ${s}`).toContain(s);
    }
  });

  it("users — the users grant can look but not change: no form, no actions", () => {
    const viewer = { ...staff, sections: ["users"] };
    const html = draw(<UsersPage />, viewer);
    expect(html).toContain("needs an administrator");
    expect(html).toContain("ecom02@pintola.in");
    for (const s of ["Add a user", "Create user", "Set password", "Deactivate", "Make admin", "Tick all"]) {
      expect(html, `a non-admin must not be offered "${s}"`).not.toContain(s);
    }
  });
});

describe("an empty database renders too, with an empty state that says what to do", () => {
  it("every list page", () => {
    const empty = () => ({ ...emptyStore(), users: [admin] });
    expect(draw(<PartiesPage initialView="list" />, admin, empty())).toContain("Add party");
    expect(draw(<QuotationsPage />, admin, empty())).toContain("starts the first one");
    expect(draw(<ProformaPage />, admin, empty())).toContain("No open proforma invoices");
    expect(draw(<ShipmentsPage />, admin, empty())).toContain("raise one under Proforma first");
    expect(draw(<Overview onNavigate={() => {}} />, admin, empty())).toBeTruthy();
    expect(draw(<CompanyPage />, admin, empty())).toContain("Company name");
  });
});

describe("the overview never reveals a section the account does not hold", () => {
  const only = (sections) => ({ ...staff, sections });
  it("quotations only: the quotation count, nothing about parties, proformas or shipments", () => {
    const html = draw(<Overview onNavigate={() => {}} />, only(["overview", "quotations"]));
    expect(html).toContain("Quotations");
    for (const s of ["Parties on file", "Open proforma", "Shipments invoiced", "Awaiting shipment", "Recent activity"]) {
      expect(html).not.toContain(s);
    }
  });
  it("proforma without shipments: sees what is awaiting shipment, but no link into Shipments", () => {
    const html = draw(<Overview onNavigate={() => {}} />, only(["overview", "proforma"]));
    expect(html).toContain("Awaiting shipment");
    expect(html).not.toContain("Go to shipments");
    expect(html).not.toContain("Shipments invoiced");
  });
  it("recent activity needs the users grant", () => {
    expect(draw(<Overview onNavigate={() => {}} />, only(["overview"]))).not.toContain("Recent activity");
    expect(draw(<Overview onNavigate={() => {}} />, only(["overview", "users"]))).toContain("Recent activity");
  });
});
