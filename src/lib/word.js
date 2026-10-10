// A quotation or a proforma as a Word file (.docx). Each is drawn from its
// model — the same description the printed page (PDF) is drawn from — so it
// carries the same words and the same figures, laid out the same way. Unlike
// the PDF, every part of it can be edited in Word afterwards.
import { quotationModel, quotationFileName, proformaModel, fileSafe } from "./documents.js";

// The print colours of tokens.css, as Word wants them.
const INK = "111111";
const MUTED = "555555";
const RULE = "999999";
const FILL = "F1F1F1";

// Sizes are in half-points; the PDF is set in 12px (9pt) Georgia.
const BODY = 18;
const SMALL = 17;
const NAME = 27;
const TITLE = 30;

// A4 with 14 mm margins, as the PDF. Measured in twips (1/20 pt); 15 to a px.
const PAGE = { width: 11906, height: 16838, margin: 794 };
const CONTENT = PAGE.width - 2 * PAGE.margin;
const px = (n) => Math.round(n * 15);
const HALF = [Math.round(CONTENT / 2), CONTENT - Math.round(CONTENT / 2)];
const LETTERHEAD = [Math.round(CONTENT * 0.6), CONTENT - Math.round(CONTENT * 0.6)];

// A Word file cannot hold a control character, and a line break inside a box
// prints as a space on the PDF — so it does here too.
export const wordText = (value) => String(value ?? "")
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
  .replace(/\s*[\r\n]+\s*/g, " ");

// The pieces both documents are built from. docx: the "docx" library, passed
// in so that only a download loads it.
function kit(docx) {
  const { Document, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle, ShadingType, TableLayoutType, VerticalAlign } = docx;

  const run = (text, o = {}) => new TextRun({
    text: wordText(text), bold: o.bold, italics: o.italics, size: o.size, allCaps: o.caps,
    color: o.muted ? MUTED : undefined, characterSpacing: o.tracking,
  });
  const para = (runs, o = {}) => new Paragraph({
    children: [].concat(runs),
    alignment: o.right ? AlignmentType.RIGHT : AlignmentType.LEFT,
    spacing: { before: o.before || 0, after: o.after || 0 },
    border: o.border, keepNext: o.keepNext, run: o.mark,
  });
  // A paragraph that only holds space (or a rule): its own line is made as small as Word allows.
  const spacer = (o) => para(run("", { size: 2 }), { ...o, mark: { size: 2 } });
  const label = (text, o = {}) => para(run(text, { muted: true, size: SMALL, caps: true, tracking: 10 }), o);
  const filled = (list) => list.filter((t) => wordText(t).trim() !== "");

  const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  const line = { style: BorderStyle.SINGLE, size: 6, color: RULE };
  const all = (b) => ({ top: b, bottom: b, left: b, right: b });

  // Two things side by side, with nothing drawn around them.
  const sideBySide = (left, right, widths, gap = 0, o = {}) => new Table({
    width: { size: CONTENT, type: WidthType.DXA }, columnWidths: widths, layout: TableLayoutType.FIXED,
    borders: { ...all(none), insideHorizontal: none, insideVertical: none },
    rows: [new TableRow({
      cantSplit: true,
      children: [left, right].map((children, i) => new TableCell({
        width: { size: widths[i], type: WidthType.DXA }, borders: all(none), children,
        verticalAlign: o.bottom ? VerticalAlign.BOTTOM : undefined,
        margins: { top: 0, bottom: 0, left: i === 1 ? gap : 0, right: i === 0 ? gap : 0 },
      })),
    })],
  });

  // The letterhead, the document's name and number, and the rule under them.
  const letterhead = (m, headLines) => [
    sideBySide(
      [
        para(run(m.companyName, { bold: true, size: NAME })),
        ...(m.companyAddress ? [para(run(m.companyAddress, { muted: true }), { before: px(2) })] : []),
        ...(m.companyIds ? [para(run(m.companyIds, { muted: true }), { before: px(2) })] : []),
      ],
      [
        para(run(m.title, { size: TITLE, caps: true, tracking: 36 }), { right: true }),   // not bold: the printed heading is not
        para(run(m.docNoLine, { bold: true }), { right: true, before: px(6) }),
        ...headLines.map((t) => para(run(t, { muted: true }), { right: true })),
      ],
      LETTERHEAD,
    ),
    spacer({ before: px(8), after: px(14), border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: INK, space: 1 } } }),
  ];

  // The price table. columns: [{ label, lines?, width?, num? }] — a width is
  // the PDF's, in px, and the column without one takes what is left. lines:
  // one array of texts per product. totals: rows of cells
  // [{ text, span?, strong?, bare? }], right-aligned as on the PDF.
  const priceTable = (columns, lines, totals) => {
    // A little wider than the PDF: Word keeps a column to its width where the
    // browser lets a heading push it out.
    // And never narrower than its own heading ("TAXABLE VALUE"), so a heading stays on its line.
    const heading = (c) => px(Math.max(...(c.lines || [c.label]).map((l) => wordText(l).length)) * 9.2 + 18);
    const fit = (c) => Math.max(Math.round(px(c.width) * 1.1), heading(c));
    const fixed = columns.reduce((sum, c) => sum + (c.width ? fit(c) : 0), 0);
    const widths = columns.map((c) => (c.width ? fit(c) : CONTENT - fixed));
    const cell = (text, i, o = {}) => new TableCell({
      width: { size: o.span ? widths.slice(i, i + o.span).reduce((a, b) => a + b, 0) : widths[i], type: WidthType.DXA },
      columnSpan: o.span, borders: all(line),
      margins: { top: px(6), bottom: px(6), left: px(8), right: px(8) },
      shading: o.head ? { type: ShadingType.CLEAR, fill: FILL, color: "auto" } : undefined,
      // A heading can run over several lines ("Price (USD)" / "(Case/Box)" / "FOB"): a paragraph each.
      children: [].concat(text).map((t) => para(run(t, o.head ? { bold: true, size: SMALL, caps: true, tracking: 10 } : { bold: o.bold }), { right: o.right })),
    });
    return new Table({
      width: { size: CONTENT, type: WidthType.DXA }, columnWidths: widths, layout: TableLayoutType.FIXED,
      borders: { ...all(line), insideHorizontal: line, insideVertical: line },
      rows: [
        new TableRow({ tableHeader: true, cantSplit: true, children: columns.map((c, i) => cell(c.lines || c.label, i, { head: true, right: c.num })) }),
        ...lines.map((cells) => new TableRow({ cantSplit: true, children: cells.map((text, i) => cell(text, i, { right: columns[i].num })) })),
        ...totals.map((row) => {
          let at = 0;
          return new TableRow({
            cantSplit: true,
            children: row.map((c) => {
              const made = cell(c.text, at, { span: c.span, right: !c.bare, bold: c.strong });
              at += c.span || 1;
              return made;
            }),
          });
        }),
      ],
    });
  };

  const signature = (m, o = {}) => [
    para([run("For "), run(m.signFor, { bold: true })], { right: true, before: o.before || 0, keepNext: true }),
    para(run(m.signatory, { muted: true }), { right: true, before: px(44) }),
  ];

  const document = (m, children) => new Document({
    creator: wordText(m.companyName), title: wordText(`${m.title} ${m.docNo}`),
    styles: { default: { document: { run: { font: "Georgia", size: BODY, color: INK }, paragraph: { spacing: { line: 312 } } } } },
    sections: [{
      properties: { page: {
        size: { width: PAGE.width, height: PAGE.height },
        margin: { top: PAGE.margin, right: PAGE.margin, bottom: PAGE.margin, left: PAGE.margin },
      } },
      children,
    }],
  });

  return { run, para, spacer, label, filled, sideBySide, letterhead, priceTable, signature, document };
}

export function buildQuotationDocx(docx, m) {
  const { run, para, spacer, label, filled, sideBySide, letterhead, priceTable, signature, document } = kit(docx);
  const last = m.columns.length - 1;
  return document(m, [
    ...letterhead(m, [m.date]),
    sideBySide(
      [
        label(m.toLabel),
        para(run(m.buyerName, { bold: true }), { before: px(3) }),
        ...filled([m.buyerAddress, m.country]).map((t) => para(run(t, { muted: true }))),
      ],
      [label(m.termsLabel), ...m.terms.map((t, i) => para(run(t), { before: i === 0 ? px(3) : 0 }))],
      HALF, px(16),
    ),
    // Two tables with nothing between them would be joined into one by Word.
    spacer({ before: px(5), after: px(5) }),
    priceTable(m.columns, m.lines, m.totals.map((t) => [{ text: t.label, span: last, strong: t.strong }, { text: t.value, strong: t.strong }])),
    para(run(m.words, { italics: true }), { before: px(8) }),
    ...(m.conditions.length ? [
      label(m.conditionsLabel, { before: px(16), keepNext: true }),
      ...m.conditions.map((t, i) => para(run(t), { before: i === 0 ? px(3) : px(2) })),
    ] : []),
    ...signature(m, { before: px(48) }),
  ]);
}

export function buildProformaDocx(docx, m) {
  const { run, para, spacer, label, filled, sideBySide, letterhead, priceTable, signature, document } = kit(docx);
  const block = (b) => [label(b.label), ...b.lines.map((t, i) => para(run(t), { before: i === 0 ? px(3) : 0 }))];
  const party = (p) => [
    label(p.label),
    para(run(p.name, { bold: true }), { before: px(3) }),
    ...filled([p.address]).map((t) => para(run(t, { muted: true }))),
  ];
  const small = (text, o) => para(run(text, { muted: true, size: SMALL }), o);
  return document(m, [
    ...letterhead(m, m.headLines),
    sideBySide(party(m.parties[0]), party(m.parties[1]), HALF, px(16)),
    spacer({ before: px(6), after: px(6) }),
    // Ports beside the terms when there are ports; the terms alone when not.
    ...(m.ports ? [sideBySide(block(m.ports), block(m.terms), HALF, px(16))] : block(m.terms)),
    spacer({ before: px(5), after: px(5) }),
    priceTable(m.columns, m.lines, m.totals),
    para(run(m.words, { italics: true }), { before: px(8) }),
    ...(m.conditions && m.conditions.inline ? [small(m.conditions.inline, { before: px(10) })] : []),
    ...(m.conditions && m.conditions.lines ? [
      small(m.conditions.label, { before: px(10), keepNext: true }),
      ...m.conditions.lines.map((t) => small(t)),
    ] : []),
    ...(m.additional ? [small(m.additional, { before: px(6) })] : []),
    spacer({ before: px(14), after: px(14) }),
    // The bank details on the left, the signature on the right, their feet level — as printed.
    sideBySide(
      [
        para(run(m.bank.title, { bold: true })),
        ...m.bank.rows.map(([name, value], i) => para([run(name, { bold: true }), run(` ${value}`)], { before: i === 0 ? px(3) : 0 })),
      ],
      signature(m),
      LETTERHEAD, 0, { bottom: true },
    ),
  ]);
}

export const quotationWordName = (q) => `${quotationFileName(q)}.docx`;
export const proformaWordName = (pi) => `Proforma-${fileSafe(pi.docNo)}.docx`;

// The library is large and only a Word download needs it, so it is loaded then.
async function saveWord(name, build) {
  const docx = await import("docx");
  const blob = await docx.Packer.toBlob(build(docx));
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const downloadQuotationWord = (q, company) =>
  saveWord(quotationWordName(q), (docx) => buildQuotationDocx(docx, quotationModel(q, company)));
export const downloadProformaWord = (pi, company) =>
  saveWord(proformaWordName(pi), (docx) => buildProformaDocx(docx, proformaModel(pi, company)));
