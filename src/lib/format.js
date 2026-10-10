// The one strict number + date utility (Build Bible §7.10). Every screen and
// every export formats through here, so a rule changes in one place.

export const IST = "Asia/Kolkata";
export const CURRENCY_SYMBOL = { USD: "$", INR: "₹" };

// Today's date in IST as yyyy-mm-dd. Never derive "today" from toISOString():
// that is UTC, and is yesterday until 05:30 IST.
export function todayIST(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: IST, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

// yyyy-mm-dd → dd/mm/yyyy by string surgery, so no timezone can shift the day.
export function fmtDate(iso) {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso);
}

// A timestamp, shown in IST as dd/mm/yyyy HH:MM.
export function fmtWhen(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: IST, day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d).replace(",", "");
}

// Accepts numbers and typed strings: "1,200", " 1.85 ", "(250)" → -250.
// Blank is zero. Anything unparseable is zero rather than NaN, so a total
// never renders as "NaN"; the server refuses a non-number outright.
export function toNumber(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  let s = String(value).trim().replace(/,/g, "");
  let negative = false;
  const paren = /^\((.*)\)$/.exec(s);
  if (paren) { negative = true; s = paren[1]; }
  if (s === "") return 0;
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return negative ? -n : n;
}

export function fmtNum(value, digits = 2) {
  return toNumber(value).toLocaleString("en-IN", {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  });
}

export function fmtMoney(value, currency) {
  const n = Math.round(toNumber(value) * 100) / 100;
  const locale = currency === "INR" ? "en-IN" : "en-US";
  return `${CURRENCY_SYMBOL[currency] || ""}${n.toLocaleString(locale, {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;
}

// boxes → units. Both are shown everywhere a quantity appears.
export function unitsFromBoxes(boxes, packsPerBox) {
  return toNumber(boxes) * toNumber(packsPerBox);
}

const ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function below1000(n) {
  if (n === 0) return "";
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : "");
  return ONES[Math.floor(n / 100)] + " hundred" + (n % 100 ? " " + below1000(n % 100) : "");
}

// thousand / million / billion
function wordsInternational(n) {
  if (n === 0) return "zero";
  const parts = [];
  const scale = [[1e9, "billion"], [1e6, "million"], [1e3, "thousand"]];
  let rem = n;
  for (const [size, name] of scale) {
    const q = Math.floor(rem / size);
    if (q) { parts.push(below1000(q) + " " + name); rem %= size; }
  }
  if (rem) parts.push(below1000(rem));
  return parts.join(" ");
}

// thousand / lakh / crore — what an Indian tax invoice is read in
function wordsIndian(n) {
  if (n === 0) return "zero";
  const parts = [];
  let rem = n;
  const crore = Math.floor(rem / 1e7); rem %= 1e7;
  const lakh = Math.floor(rem / 1e5); rem %= 1e5;
  const thousand = Math.floor(rem / 1e3); rem %= 1e3;
  if (crore) parts.push(wordsIndian(crore) + " crore");
  if (lakh) parts.push(below1000(lakh) + " lakh");
  if (thousand) parts.push(below1000(thousand) + " thousand");
  if (rem) parts.push(below1000(rem));
  return parts.join(" ");
}

// "Rupees one lakh ninety three thousand four hundred seventy three only"
// "US Dollars two thousand two hundred twenty and fifty cents only"
// Without a currency: the bare number, with any fraction as nn/100.
export function amountInWords(value, currency) {
  const cents = Math.round(Math.abs(toNumber(value)) * 100);
  const whole = Math.floor(cents / 100);
  const frac = cents % 100;
  if (currency === "INR") {
    return `Rupees ${wordsIndian(whole)}${frac ? ` and ${below1000(frac)} paise` : ""} only`;
  }
  if (currency === "USD") {
    return `US Dollars ${wordsInternational(whole)}${frac ? ` and ${below1000(frac)} cents` : ""} only`;
  }
  return `${wordsInternational(whole)}${frac ? ` and ${String(frac).padStart(2, "0")}/100` : ""} only`;
}

// Weights are STORED in kilograms per box — the packing list and every total
// are in kg. The party form takes them in grams, so it converts on the way in
// and on the way out. Rounded so 1360 g is 1.36 kg, not 1.3599999.
export const gramsFromKg = (kg) => Math.round(toNumber(kg) * 1e6) / 1e3;
export const kgFromGrams = (g) => Math.round(toNumber(g) * 1e3) / 1e6;

// A party can carry several conditions. They are kept as ONE text, a
// condition per line — the column and every function that copies it are
// unchanged, and a proforma raised earlier with a single condition reads the
// same as before. These two turn the text into a list and back.
export const conditionsFromText = (text) =>
  String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
export const conditionsToText = (list) =>
  (list || []).map((line) => String(line || "").replace(/\s*\r?\n\s*/g, " ").trim()).filter(Boolean).join("\n");

// A product's weights can be typed in grams, kilograms or MT (db/019) — one
// unit per product line, covering net and gross. Whatever is chosen, the
// weight is STORED in kilograms per box: the unit only says how the line was
// typed, so the form can show it back the same way. Rounded so 1360 g is
// 1.36 kg and 12 kg is 0.012 MT, with no stray digits from floating point.
export const WEIGHT_UNITS = [{ key: "g", label: "g" }, { key: "kg", label: "kg" }, { key: "mt", label: "MT" }];
const KG_PER_UNIT = { g: 0.001, kg: 1, mt: 1000 };
const tidyWeight = (n) => Math.round(n * 1e9) / 1e9;
export const weightUnitOf = (unit) => (Object.prototype.hasOwnProperty.call(KG_PER_UNIT, unit) ? unit : "g");
export const kgFromWeight = (value, unit) => tidyWeight(toNumber(value) * KG_PER_UNIT[weightUnitOf(unit)]);
export const weightFromKg = (kg, unit) => tidyWeight(toNumber(kg) / KG_PER_UNIT[weightUnitOf(unit)]);

// The weight of ONE piece (db/020) follows the same idea with a different
// store: it is kept in GRAMS whatever unit it was typed in, with the unit
// beside it — so "1 kg" is stored as 1000 g and reads back as 1 kg.
export const gramsFromWeight = (value, unit) => tidyWeight(kgFromWeight(value, unit) * 1000);
export const weightFromGrams = (grams, unit) => weightFromKg(toNumber(grams) / 1000, unit);
// "400 g", "1 kg". Nothing given says nothing.
export function packWeightText(grams, unit) {
  const n = weightFromGrams(grams, unit);
  if (!(n > 0)) return "";
  return `${n} ${WEIGHT_UNITS.find((u) => u.key === weightUnitOf(unit)).label}`;
}
// What tells two lines of the same product apart: the secondary name if the
// line has one, otherwise its pack in words ("400 g × 20").
export function packLabel(product) {
  const secondary = String((product && product.secondaryName) || "").trim();
  if (secondary) return secondary;
  const weight = packWeightText(product && product.weightPerPackG, product && product.packWeightUnit);
  return weight ? `${weight} × ${toNumber(product.packsPerBox)}` : "";
}

// A product's shelf life is a length and a unit, kept as typed — "2 years" is
// not turned into 24 months. Nothing given reads as nothing, not "0 months".
export const SHELF_LIFE_UNITS = ["months", "years"];
export function shelfLifeText(value, unit) {
  const n = toNumber(value);
  if (!(n > 0)) return "";
  const u = unit === "years" ? "year" : "month";
  return `${n} ${u}${n === 1 ? "" : "s"}`;
}

// A short random id for rows that only exist on screen. The database never
// sees these as identities — a non-uuid id is how it recognises a new row.
export const tempId = () => Math.random().toString(36).slice(2, 10);

// A quotation says which currency its prices are in (db/023, decisions/028).
// Each figure then carries the currency in front, and the amount in words is
// written the formal way:
//   "US$ 49,999.50"   "U.S. DOLLARS Forty-Nine Thousand Nine Hundred Ninety-Nine And Fifty Cents Only."
//   "₹ 1,23,456.00"   "INDIAN RUPEES One Lakh Twenty-Three Thousand Four Hundred Fifty-Six Only."
// Nothing is converted — the currency names what the typed figures are in. A
// quotation with no currency (made before db/023) keeps its bare figures.
export const QUOTE_CURRENCIES = [{ key: "USD", label: "USD — US Dollar (US$)" }, { key: "INR", label: "INR — Indian Rupee (₹)" }];
const DOC_CURRENCY = {
  USD: { mark: "US$", name: "U.S. DOLLARS", minor: "Cents", locale: "en-US", words: wordsInternational },
  INR: { mark: "₹", name: "INDIAN RUPEES", minor: "Paise", locale: "en-IN", words: wordsIndian },
};
export const quoteCurrencyOf = (currency) => (Object.prototype.hasOwnProperty.call(DOC_CURRENCY, currency) ? currency : "");

export function docMoney(value, currency) {
  const c = DOC_CURRENCY[quoteCurrencyOf(currency)];
  if (!c) return fmtNum(value);
  const n = Math.round(toNumber(value) * 100) / 100;
  return `${c.mark} ${n.toLocaleString(c.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// "forty nine thousand" → "Forty-Nine Thousand"
const titled = (words) => words
  .replace(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety) (one|two|three|four|five|six|seven|eight|nine)\b/g, "$1-$2")
  .replace(/\b[a-z]/g, (ch) => ch.toUpperCase());

export function docAmountInWords(value, currency) {
  const c = DOC_CURRENCY[quoteCurrencyOf(currency)];
  if (!c) return amountInWords(value);
  const cents = Math.round(Math.abs(toNumber(value)) * 100);
  const whole = Math.floor(cents / 100);
  const frac = cents % 100;
  return `${c.name} ${titled(c.words(whole))}${frac ? ` And ${titled(below1000(frac))} ${c.minor}` : ""} Only.`;
}
