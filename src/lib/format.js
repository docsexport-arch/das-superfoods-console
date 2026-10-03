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

// A short random id for rows that only exist on screen. The database never
// sees these as identities — a non-uuid id is how it recognises a new row.
export const tempId = () => Math.random().toString(36).slice(2, 10);
