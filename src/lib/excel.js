import { todayIST } from "./format.js";

// A cell beginning = + - @ (or a tab / carriage return) is executed as a
// formula by Excel. Text that came from a user is prefixed so it stays text.
// Numbers are passed through untouched — a negative amount is not a formula.
export function defang(value) {
  if (typeof value !== "string") return value;
  return /^[=+\-@\t\r]/.test(value) ? "'" + value : value;
}

// columns: [{ label, value: (row) => cell, width? }]
export function buildSheetData(columns, rows) {
  return [
    columns.map((c) => c.label),
    ...rows.map((row) => columns.map((c) => {
      const v = c.value(row);
      return v === null || v === undefined ? "" : defang(v);
    })),
  ];
}

// SheetJS is loaded on demand: it is large, and only an export needs it.
export async function exportExcel(name, columns, rows) {
  const XLSX = await import("xlsx");
  const sheet = XLSX.utils.aoa_to_sheet(buildSheetData(columns, rows));
  sheet["!cols"] = columns.map((c) => ({ wch: c.width || 18 }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, name.slice(0, 31));
  XLSX.writeFile(book, `${name}-${todayIST()}.xlsx`);
}
