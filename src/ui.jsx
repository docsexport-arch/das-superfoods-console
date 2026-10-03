// Shared building blocks. Every class here resolves to a token in tokens.css.
import React, { useEffect, useRef, useState } from "react";
import { FileSpreadsheet, TriangleAlert, RefreshCw } from "lucide-react";
import { exportExcel } from "./lib/excel.js";

const press = "transition-transform duration-150 ease-emil active:scale-[0.97]";

export const card = "rounded-xl border border-[var(--line)] bg-[var(--card)]";
export const panel = "rounded-xl border border-[var(--line)] bg-[var(--panel)]";
export const input = "w-full rounded-lg border border-[var(--line)] bg-[var(--field)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--faint)] focus:border-[var(--accent)] disabled:opacity-50";
export const btn = `rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-ink)] hover:opacity-90 disabled:opacity-40 ${press}`;
export const btnGhost = `rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--muted)] disabled:opacity-40 ${press}`;
export const th = "px-4 py-3 text-left text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--muted)]";
export const td = "px-4 py-3 text-sm";
export const tdNum = "px-4 py-3 text-sm text-right font-num tabular-nums";
export const label = "block text-sm font-medium text-[var(--text)] mb-2";
export const errText = "text-sm text-[var(--status-danger)]";

export function Field({ label: labelText, children, className = "", hint }) {
  return (
    <label className={"block " + className}>
      <span className={label}>{labelText}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-[var(--muted)]">{hint}</span>}
    </label>
  );
}

export function Chip({ children, tone = "neutral" }) {
  const tones = {
    neutral: "border-[var(--line)] text-[var(--muted)]",
    accent: "border-[var(--accent)]/40 text-[var(--accent)]",
    ok: "border-[var(--status-ok)]/40 text-[var(--status-ok)]",
    warn: "border-[var(--status-warn)]/40 text-[var(--status-warn)]",
    off: "border-[var(--line)] text-[var(--faint)]",
  };
  return <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] ${tones[tone]}`}>{children}</span>;
}

export function PageHead({ title, blurb }) {
  return (
    <div className="mb-8">
      <h1 className="font-display text-3xl tracking-tight text-[var(--text)]">{title}</h1>
      {blurb && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">{blurb}</p>}
    </div>
  );
}

// A read that failed is shown as a failure — never as an empty table.
export function ErrorPanel({ message, onRetry }) {
  return (
    <div role="alert" className={card + " flex items-start gap-3 border-[var(--status-danger)]/40 p-5"}>
      <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-[var(--status-danger)]" />
      <div>
        <p className="text-sm font-medium">This could not be loaded</p>
        <p className="mt-1 text-sm text-[var(--muted)]">{message}</p>
        <p className="mt-1 text-xs text-[var(--faint)]">
          Nothing is shown rather than a figure that might be wrong.
        </p>
        {onRetry && (
          <button onClick={onRetry} className={btnGhost + " mt-3 flex items-center gap-1.5"}>
            <RefreshCw className="h-3.5 w-3.5" /> Try again
          </button>
        )}
      </div>
    </div>
  );
}

// Every table gets one of these. `columns` is [{ label, value(row), width? }].
export function ExcelButton({ name, columns, rows }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async () => {
    setBusy(true); setError("");
    try { await exportExcel(name, columns, rows); }
    catch (e) { setError("The Excel file could not be created."); }
    setBusy(false);
  };
  return (
    <span className="inline-flex items-center gap-2">
      {error && <span className={errText}>{error}</span>}
      <button onClick={run} disabled={busy || rows.length === 0} className={btnGhost + " flex items-center gap-1.5"}
        title={rows.length === 0 ? "Nothing to export yet" : `Download ${rows.length} row(s) as Excel`}>
        <FileSpreadsheet className="h-4 w-4" /> {busy ? "Preparing…" : "Excel"}
      </button>
    </span>
  );
}

// An accessible modal: labelled, focus-trapped, closes on Escape, and hands
// focus back to whatever opened it.
export function Dialog({ title, onClose, children }) {
  const boxRef = useRef(null);
  useEffect(() => {
    const opener = document.activeElement;
    const box = boxRef.current;
    const focusables = () => box.querySelectorAll("button, input, select, textarea, [href], [tabindex]:not([tabindex='-1'])");
    const first = focusables()[0];
    if (first) first.focus();
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (!items.length) return;
      const head = items[0], tail = items[items.length - 1];
      if (e.shiftKey && document.activeElement === head) { e.preventDefault(); tail.focus(); }
      else if (!e.shiftKey && document.activeElement === tail) { e.preventDefault(); head.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (opener && opener.focus) opener.focus();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-[var(--scrim)] p-6 pt-24"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={boxRef} role="dialog" aria-modal="true" aria-label={title} className={card + " w-full max-w-md p-6"}>
        <p className="mb-5 font-display text-xl">{title}</p>
        {children}
      </div>
    </div>
  );
}
