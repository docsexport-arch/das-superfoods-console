// The shipment money rule (decisions/002), mirrored from the database so the
// form can PREVIEW what the server will compute. The server's figure is the
// one that is saved — public.create_shipment() does this same arithmetic and
// tests/money.test.js pins this mirror to numbers the database produced.
//
//   · Line amounts, freight and other charges are in the proforma's currency.
//   · The tax invoice is always INR: a USD proforma converts at the exchange
//     rate entered for the shipment. GST and round-off apply to the INR figure.
//   · The commercial invoice is in the currency chosen for the shipment.
import { toNumber } from "./format.js";

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

export function shipmentTotals({ items, type, currency, exchangeRate, gstPercent, roundOff, freight, otherAdj, commercialCurrency }) {
  const international = type === "international";
  let boxes = 0, packs = 0, net = 0, gross = 0, base = 0;
  for (const it of items || []) {
    const qty = toNumber(it.boxQty);
    boxes += qty;
    packs += qty * toNumber(it.packsPerBox);
    net += qty * toNumber(it.netWt);
    gross += qty * toNumber(it.grossWt);
    base += qty * toNumber(international ? it.rate : it.mrp);
  }
  const rate = currency === "INR" ? 1 : toNumber(exchangeRate);
  const docTotal = round2(base + toNumber(freight) + toNumber(otherAdj));
  const inrTotal = round2(docTotal * rate);
  const gst = round2(inrTotal * toNumber(gstPercent) / 100);
  const comCurrency = commercialCurrency || currency;
  let commercialTotal = docTotal;
  if (comCurrency !== currency) commercialTotal = comCurrency === "INR" ? inrTotal : (rate > 0 ? round2(docTotal / rate) : 0);
  return {
    boxes, packs, net, gross,
    docTotal, inrTotal, gst,
    grandTotal: round2(inrTotal + gst + toNumber(roundOff)),
    commercialTotal, commercialCurrency: comCurrency,
    needsExchangeRate: currency !== "INR" && !(rate > 0),
  };
}

export function quotationTotals({ items, country, igst, igstRate }) {
  const total = round2((items || []).reduce((s, it) => s + toNumber(it.boxQty) * toNumber(it.boxRate), 0));
  const domestic = String(country || "").trim().toLowerCase() === "india";
  const rate = domestic && igst ? toNumber(igstRate) : 0;
  const tax = round2(total * rate / 100);
  return { total, tax, grand: round2(total + tax), domestic };
}

export function proformaTotals({ items, type, taxRate }) {
  const international = type === "international";
  let boxes = 0, total = 0, taxable = 0, units = 0;
  for (const it of items || []) {
    const qty = toNumber(it.boxQty);
    boxes += qty;
    units += qty * toNumber(it.packsPerBox);
    total += qty * toNumber(it.rate);
    taxable += qty * toNumber(it.mrp);
  }
  total = round2(total); taxable = round2(taxable);
  const tax = international ? 0 : round2(taxable * toNumber(taxRate) / 100);
  return { boxes, units, total, taxable, tax, grand: international ? total : round2(taxable + tax) };
}
