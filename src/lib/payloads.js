// What the client sends to each write RPC — named once.
//
// An RPC reads its payload key by key, so a key it does not read is silently
// thrown away (Build Bible §6). These lists are the contract:
// tests/rpc-contract.test.js reads db/*.sql and fails the build if any key
// listed here is not read by the function it is sent to. Extend the SQL and
// the list in the same commit.
export const PARTY_KEYS = [
  "id", "type", "buyerName", "buyerAddress", "consigneeName", "consigneeAddress",
  "consigneeOptions", "altBuyers", "country", "currency", "shipmentTerm", "paymentTerm",
  "conditions", "portOfLoading", "destinationPort", "products",
  "buyerMobile", "buyerEmail", "buyerTaxId", "consigneeMobile", "consigneeEmail", "consigneeTaxId",
];
// One entry of altBuyers — another name the same party orders under.
export const ALT_BUYER_KEYS = ["name", "address"];
export const PARTY_PRODUCT_KEYS = [
  "id", "name", "hsn", "rate", "mrp", "netWt", "grossWt", "packsPerBox", "weightPerPackG",
  "shelfLife", "shelfLifeUnit", "weightUnit", "secondaryName", "packWeightUnit",
];
export const QUOTATION_KEYS = [
  "id", "partyId", "buyerName", "buyerAddress", "country", "shipmentTerm",
  "paymentTerm", "igst", "igstRate", "items", "expectedUpdatedAt",
];
export const PROFORMA_KEYS = [
  "id", "expectedUpdatedAt", "docNo", "type", "partyId", "quotationRef", "buyerName", "buyerAddress", "consigneeName",
  "consigneeAddress", "consigneeOptions", "portOfLoading", "destinationPort",
  "shipmentTerm", "paymentTerm", "conditions", "currency", "buyerOrderNo",
  "buyerOrderDate", "additionalDetails", "taxRate", "items",
];
export const SHIPMENT_KEYS = [
  "id", "expectedUpdatedAt", "piId", "items", "freight", "otherAdj", "otherReason", "gstPercent", "roundOff",
  "exchangeRate", "commercialCurrency", "commercialConsignee", "taxConsignee",
  "containerNo", "vehicleNo", "customSeal", "lineSeal", "portOfLoading", "incoterm",
];
export const COMPANY_KEYS = [
  "name", "address", "accountName", "bankName", "bankBranch", "accountNo", "swift", "gstNo", "iecCode",
];
export const USER_ACCESS_KEYS = ["role", "fullName", "active", "sections"];
// A saved draft. `payload` is the form's own state and is stored as it is —
// the document functions validate it when the document is raised.
export const DRAFT_KEYS = ["id", "kind", "title", "refId", "payload", "expectedUpdatedAt"];

// Which function each list is sent to — used by the contract test.
export const RPC_CONTRACT = {
  save_party: [...PARTY_KEYS, ...PARTY_PRODUCT_KEYS, ...ALT_BUYER_KEYS],
  save_quotation: QUOTATION_KEYS,
  save_proforma: PROFORMA_KEYS,
  save_shipment: SHIPMENT_KEYS,
  save_company: COMPANY_KEYS,
  set_user_access: USER_ACCESS_KEYS,
  save_draft: DRAFT_KEYS,
};

// Copies only the named keys, skipping any that are undefined.
export const pick = (obj, keys) =>
  Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
