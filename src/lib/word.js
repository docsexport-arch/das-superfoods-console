// A quotation as a Word file (.docx). It is drawn from quotationModel — the
// same description the printed page (PDF) is drawn from — so it carries the
// same words and the same figures, laid out the same way. Unlike the PDF,
// every part of it can be edited in Word afterwards.
import { quotationModel, fileSafe } from "./documents.js";

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

// A Word file cannot hold a control character, and a line break inside a box
// prints as a space on the PDF — so it does here too.
export const wordText = (value) => String(value ?? "")
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
  .replace(/\s*[\r\n]+\s*/g, " ");

// docx: the "docx" library, passed in so that only a download loads it.
export function buildQuotationDocx(docx, m) {
  const { Document, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle, ShadingType, TableLayoutType } = docx;

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
  const label = (text) => para(run(text, { muted: true, size: SMALL, caps: true, tracking: 10 }));

  const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  const line = { style: BorderStyle.SINGLE, size: 6, color: RULE };
  const all = (b) => ({ top: b, bottom: b, left: b, right: b });

  // Two things side by side, with nothing drawn around them.
  const sideBySide = (left, right, widths, gap = 0) => new Table({
    width: { size: CONTENT, type: WidthType.DXA }, columnWidths: widths, layout: TableLayoutType.FIXED,
    borders: { ...all(none), insideHorizontal: none, insideVertical: none },
    rows: [new TableRow({
      children: [left, right].map((children, i) => new TableCell({
        width: { size: widths[i], type: WidthType.DXA }, borders: all(none), children,
        margins: { top: 0, bottom: 0, left: i === 1 ? gap : 0, right: i === 0 ? gap : 0 },
      })),
    })],
  });

  // Fixed widths are the PDF's, a little wider: Word keeps a column to its width where the
  // browser lets a heading push it out. The product column takes what is left.
  const fit = (width) => Math.round(px(width) * 1.1);
  const fixed = m.columns.reduce((sum, c) => sum + (c.width ? fit(c.width) : 0), 0);
  const widths = m.columns.map((c) => (c.width ? fit(c.width) : CONTENT - fixed));
  const cell = (text, i, o = {}) => new TableCell({
    width: { size: o.span ? widths.slice(i, i + o.span).reduce((a, b) => a + b, 0) : widths[i], type: WidthType.DXA },
    columnSpan: o.span, borders: all(line),
    margins: { top: px(6), bottom: px(6), left: px(8), right: px(8) },
    shading: o.head ? { type: ShadingType.CLEAR, fill: FILL, color: "auto" } : undefined,
    children: [para(run(text, o.head ? { bold: true, size: SMALL, caps: true, tracking: 10 } : { bold: o.bold }), { right: o.right })],
  });
  const last = m.columns.length - 1;
  const priceTable = new Table({
    width: { size: CONTENT, type: WidthType.DXA }, columnWidths: widths, layout: TableLayoutType.FIXED,
    borders: { ...all(line), insideHorizontal: line, insideVertical: line },
    rows: [
      new TableRow({ tableHeader: true, cantSplit: true, children: m.columns.map((c, i) => cell(c.label, i, { head: true, right: c.num })) }),
      ...m.lines.map((cells) => new TableRow({ cantSplit: true, children: cells.map((text, i) => cell(text, i, { right: m.columns[i].num })) })),
      ...m.totals.map((t) => new TableRow({
        cantSplit: true,
        children: [cell(t.label, 0, { span: last, right: true, bold: t.strong }), cell(t.value, last, { right: true, bold: t.strong })],
      })),
    ],
  });

  const children = [
    sideBySide(
      [
        para(run(m.companyName, { bold: true, size: NAME })),
        ...(m.companyAddress ? [para(run(m.companyAddress, { muted: true }), { before: px(2) })] : []),
        ...(m.companyIds ? [para(run(m.companyIds, { muted: true }), { before: px(2) })] : []),
      ],
      [
        para(run(m.title, { bold: true, size: TITLE, caps: true, tracking: 36 }), { right: true }),
        para(run(m.docNo, { bold: true }), { right: true, before: px(6) }),
        para(run(m.date, { muted: true }), { right: true }),
      ],
      [Math.round(CONTENT * 0.6), CONTENT - Math.round(CONTENT * 0.6)],
    ),
    // The rule under the letterhead.
    spacer({ before: px(8), after: px(14), border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: INK, space: 1 } } }),
    sideBySide(
      [
        label(m.toLabel),
        para(run(m.buyerName, { bold: true }), { before: px(3) }),
        ...[m.buyerAddress, m.country].filter((t) => wordText(t).trim()).map((t) => para(run(t, { muted: true }))),
      ],
      [label(m.termsLabel), ...m.terms.map((t, i) => para(run(t), { before: i === 0 ? px(3) : 0 }))],
      [Math.round(CONTENT / 2), CONTENT - Math.round(CONTENT / 2)], px(16),
    ),
    // Two tables with nothing between them would be joined into one by Word.
    spacer({ before: px(5), after: px(5) }),
    priceTable,
    para(run(m.words, { italics: true }), { before: px(8) }),
    para(run(m.note, { muted: true, size: SMALL }), { before: px(18) }),
    para([run("For "), run(m.signFor, { bold: true })], { right: true, before: px(48), keepNext: true }),
    para(run(m.signatory, { muted: true }), { right: true, before: px(44) }),
  ];

  return new Document({
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
}

export const quotationWordName = (q) => `Quotation-${fileSafe(q.docNo)}.docx`;

// The library is large and only a Word download needs it, so it is loaded then.
export async function downloadQuotationWord(q, company) {
  const docx = await import("docx");
  const blob = await docx.Packer.toBlob(buildQuotationDocx(docx, quotationModel(q, company)));
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = quotationWordName(q);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
