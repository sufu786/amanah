// Text from a PDF report. Phase 2, stage 5.
//
// Many patient portals hand out reports as PDFs, and most of those PDFs carry their text, which can
// be read out exactly. A scanned page does not: it is a picture of text, and reading it needs OCR,
// which this phase leaves out (PHASE2_PLAN.md section 1) because OCR errors would feed extraction
// unseen. So a PDF with too little text in it is refused, by name, rather than read as a report with
// nothing in it. An empty result here would reach the patient as a report in which nothing was
// found, which is the false all-clear constraint C2 forbids.
//
// The text goes back to the page, where the patient sees it before anything reads it. A PDF can
// scramble reading order, and the patient is the one who can tell.
//
// The PDF library is loaded only when a PDF arrives, so the app runs without it installed and says
// what to do if someone tries.

export class PdfError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = 'PdfError';
    this.kind = kind;
  }
}

export const PDF_COPY = {
  not_pdf: 'This file is not a PDF. Choose a PDF, or paste the text of the report instead.',
  no_text: 'This PDF is a scanned picture of the report, so the app cannot read its text. Type or paste the text of the report into the box instead.',
  encrypted: 'This PDF is protected with a password, so the app cannot open it. Paste the text instead.',
  unreadable: 'This PDF could not be read. Paste the text of the report instead.',
  not_installed: 'Reading PDFs needs one more installation step on this computer: run npm install in the app folder. Until then, paste the text instead.',
};

// Fewer readable characters than this, per page on average, and the PDF is treated as scanned. A
// one-line header or a page number on a scanned page must not pass as a report.
export const MIN_CHARS_PER_PAGE = 40;

let library = null;
async function load() {
  if (!library) {
    try {
      library = await import('pdfjs-dist/legacy/build/pdf.mjs');
    } catch {
      throw new PdfError('not_installed', PDF_COPY.not_installed);
    }
  }
  return library;
}

/** The text of a PDF, page by page, lines in reading order as the file gives them. */
export async function pdfText(bytes) {
  const data = new Uint8Array(bytes);
  if (data.length < 5 || String.fromCharCode(...data.subarray(0, 5)) !== '%PDF-') {
    throw new PdfError('not_pdf', PDF_COPY.not_pdf);
  }
  const { getDocument } = await load();
  const task = getDocument({ data, isEvalSupported: false, useSystemFonts: false, verbosity: 0 });
  let doc;
  try {
    doc = await task.promise;
  } catch (e) {
    if (e?.name === 'PasswordException') throw new PdfError('encrypted', PDF_COPY.encrypted);
    throw new PdfError('unreadable', PDF_COPY.unreadable);
  }
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    const lines = [];
    let line = '';
    let lastY = null;
    for (const item of content.items) {
      if (typeof item.str !== 'string') continue;
      const y = Math.round(item.transform[5]);
      if (lastY !== null && Math.abs(y - lastY) > 2) { lines.push(line); line = ''; }
      line += item.str;
      if (item.hasEOL) { lines.push(line); line = ''; lastY = null; continue; }
      lastY = y;
    }
    if (line) lines.push(line);
    pages.push(lines.map((l) => l.replace(/\s+$/, '')).join('\n'));
  }
  // In this version of pdf.js the loading task, not the document, releases what was opened.
  await task.destroy();
  const text = pages.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  const readable = text.replace(/\s/g, '').length;
  if (readable < MIN_CHARS_PER_PAGE * Math.max(1, pages.length)) {
    throw new PdfError('no_text', PDF_COPY.no_text);
  }
  return { text, pages: pages.length };
}
