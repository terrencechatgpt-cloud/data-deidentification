import JSZip from 'jszip';
import type { LoadedDocument, TextEdit, XlsxCellLayout } from '../core/types';
import { distributeEdits, type Segment } from './segments';

const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

interface CellRef {
  sheetIdx: number;
  /** Index into the sheet's cell list (document order); resolved on a fresh clone at generation time. */
  cellIdx: number;
}

interface SheetInfo {
  path: string;
  doc: Document;
}

export interface XlsxHandle {
  zip: JSZip;
  sheets: SheetInfo[];
  sharedStrings: string[];
  financialRanges: { start: number; end: number }[];
  /** Pristine xl/sharedStrings.xml, kept so every generation scrubs from the original. */
  sharedStringsXml: string | null;
  segments: Segment[];
  cells: CellRef[];
}

function isMain(el: Element, local: string): boolean {
  return el.namespaceURI === MAIN_NS && el.localName === local;
}

function textOf(el: Element): string {
  // Concatenates every <t> under a <si>/<is>, covering rich-text runs (<r><t>).
  let out = '';
  const walk = (n: Element) => {
    if (isMain(n, 't')) {
      out += n.textContent ?? '';
      return;
    }
    if (isMain(n, 'rPh')) return; // phonetic hints are not visible cell text
    for (const c of Array.from(n.children)) walk(c);
  };
  walk(el);
  return out;
}

function parseXml(xml: string, path: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) throw new Error(`無法解析 ${path}`);
  return doc;
}

async function loadSharedStrings(zip: JSZip): Promise<string[]> {
  const file = zip.file('xl/sharedStrings.xml');
  if (!file) return [];
  const doc = parseXml(await file.async('string'), 'xl/sharedStrings.xml');
  return Array.from(doc.documentElement.children)
    .filter((si) => isMain(si, 'si'))
    .map(textOf);
}

function cellCoords(ref: string): { row: number; col: number } {
  const m = ref.match(/^([A-Z]+)(\d+)$/i);
  if (!m) return { row: 0, col: 0 };
  let col = 0;
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { row: Number(m[2]), col };
}

async function sheetPaths(zip: JSZip): Promise<{ path: string; name: string }[]> {
  // Prefer workbook order; fall back to numeric file order.
  const wb = zip.file('xl/workbook.xml');
  const rels = zip.file('xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    const wbDoc = parseXml(await wb.async('string'), 'xl/workbook.xml');
    const relDoc = parseXml(await rels.async('string'), 'xl/_rels/workbook.xml.rels');
    const targets = new Map<string, string>();
    for (const r of Array.from(relDoc.documentElement.children)) {
      const id = r.getAttribute('Id');
      const target = r.getAttribute('Target');
      if (id && target) targets.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`);
    }
    const out: { path: string; name: string }[] = [];
    for (const s of Array.from(wbDoc.getElementsByTagNameNS(MAIN_NS, 'sheet'))) {
      const rid = s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
      const p = rid ? targets.get(rid) : undefined;
      if (p && zip.file(p)) out.push({ path: p, name: s.getAttribute('name') ?? p });
    }
    if (out.length) return out;
  }
  return Object.keys(zip.files)
    .filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/.test(p))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))
    .map((path) => ({ path, name: path.replace(/^.*\//, '').replace(/\.xml$/, '') }));
}

/** Financial labels that make a numeric cell worth scanning; unlabeled numbers stay untouched. */
const FINANCIAL_HEADER = /(?:還款|退款|償還|付款|支付|應付|應收|金額|款項|總額|總計|合計|小計|單價|報價|折扣|收入|營收|支出|費用|成本|預算|稅額|稅金|消費|營業額|回款|借款|貸款|本金|利息|餘額|amount|payment|repayment|refund|revenue|income|expense|cost|budget|price|total|subtotal|tax|balance|principal|interest)/iu;

function isFormula(c: Element): boolean {
  return c.getElementsByTagNameNS(MAIN_NS, 'f').length > 0;
}

function isStringCell(c: Element): boolean {
  const t = c.getAttribute('t');
  return t === 's' || t === 'inlineStr';
}

function isNumericCell(c: Element): boolean {
  const t = c.getAttribute('t');
  return (t === null || t === 'n') && c.getElementsByTagNameNS(MAIN_NS, 'v').length > 0;
}

function hasFinancialLabel(text: string): boolean {
  return FINANCIAL_HEADER.test(text);
}

interface FinancialLabelIndex {
  /** Rows containing a financial label, for same-row numeric values. */
  labelRows: Set<number>;
  /** Earliest financial label row in each column, for labels above numeric values. */
  earliestLabelRowByCol: Map<number, number>;
}

/** Builds the financial context once per worksheet instead of rescanning every cell for every number. */
function buildFinancialLabelIndex(doc: Document, shared: string[]): FinancialLabelIndex {
  const labelRows = new Set<number>();
  const earliestLabelRowByCol = new Map<number, number>();
  for (const candidate of Array.from(doc.getElementsByTagNameNS(MAIN_NS, 'c'))) {
    if (isFormula(candidate) || !isStringCell(candidate) || !hasFinancialLabel(cellText(candidate, shared))) continue;
    const { row, col } = cellCoords(candidate.getAttribute('r') ?? '');
    labelRows.add(row);
    const existing = earliestLabelRowByCol.get(col);
    if (existing === undefined || row < existing) earliestLabelRowByCol.set(col, row);
  }
  return { labelRows, earliestLabelRowByCol };
}

function isFinancialNumericCell(c: Element, labels: FinancialLabelIndex): boolean {
  if (!isNumericCell(c) || isFormula(c)) return false;
  const target = cellCoords(c.getAttribute('r') ?? '');
  return labels.labelRows.has(target.row) || (labels.earliestLabelRowByCol.get(target.col) ?? Number.POSITIVE_INFINITY) < target.row;
}

/** Detectable value cells in document order: text cells and labelled, non-formula numeric cells. */
function textCells(doc: Document, shared: string[]): Element[] {
  const labels = buildFinancialLabelIndex(doc, shared);
  return Array.from(doc.getElementsByTagNameNS(MAIN_NS, 'c')).filter(
    (c) => !isFormula(c) && (isStringCell(c) || isFinancialNumericCell(c, labels)),
  );
}

function cellText(c: Element, shared: string[]): string {
  if (c.getAttribute('t') === 's') {
    const v = c.getElementsByTagNameNS(MAIN_NS, 'v')[0];
    const idx = Number(v?.textContent ?? '');
    return Number.isInteger(idx) ? (shared[idx] ?? '') : '';
  }
  const is = c.getElementsByTagNameNS(MAIN_NS, 'is')[0];
  if (is) return textOf(is);
  return c.getElementsByTagNameNS(MAIN_NS, 'v')[0]?.textContent ?? '';
}

function rowOf(c: Element): string {
  return (c.getAttribute('r') ?? '').replace(/[A-Z]+/i, '');
}

export async function parseXlsx(file: File): Promise<LoadedDocument> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const paths = await sheetPaths(zip);
  if (paths.length === 0) throw new Error('不是有效的 Excel (.xlsx) 檔案');
  const shared = await loadSharedStrings(zip);

  const sheets: SheetInfo[] = [];
  const segments: Segment[] = [];
  const cells: CellRef[] = [];
  const layoutSheets: { name: string; cells: XlsxCellLayout[] }[] = [];
  const financialRanges: { start: number; end: number }[] = [];
  let text = '';

  for (const [sheetIdx, { path, name }] of paths.entries()) {
    const doc = parseXml(await zip.file(path)!.async('string'), path);
    sheets.push({ path, doc });
    const layoutCells: XlsxCellLayout[] = [];
    let lastRow = '';
    textCells(doc, shared).forEach((c, cellIdx) => {
      const t = cellText(c, shared);
      if (t.length === 0) return;
      const row = rowOf(c);
      if (text.length > 0 && !text.endsWith('\n')) text += row === lastRow ? '\t' : '\n';
      lastRow = row;
      const coords = cellCoords(c.getAttribute('r') ?? '');
      segments.push({ start: text.length, end: text.length + t.length, text: t });
      layoutCells.push({ start: text.length, end: text.length + t.length, ...coords });
      if (isNumericCell(c)) financialRanges.push({ start: text.length, end: text.length + t.length });
      cells.push({ sheetIdx, cellIdx });
      text += t;
    });
    layoutSheets.push({ name, cells: layoutCells });
    if (!text.endsWith('\n')) text += '\n';
    text += '\n';
  }

  const sharedStringsXml = (await zip.file('xl/sharedStrings.xml')?.async('string')) ?? null;
  const handle: XlsxHandle = { zip, sheets, sharedStrings: shared, financialRanges, sharedStringsXml, segments, cells };
  return { fileName: file.name, format: 'xlsx', text, handle, layout: { kind: 'xlsx', sheets: layoutSheets } };
}

function setInlineString(c: Element, value: string): void {
  const doc = c.ownerDocument;
  for (const child of Array.from(c.children)) {
    if (isMain(child, 'v') || isMain(child, 'is') || isMain(child, 'f')) c.removeChild(child);
  }
  c.setAttribute('t', 'inlineStr');
  const is = doc.createElementNS(MAIN_NS, 'is');
  const t = doc.createElementNS(MAIN_NS, 't');
  t.setAttributeNS(XML_NS, 'xml:space', 'preserve');
  t.textContent = value;
  is.append(t);
  c.append(is);
}

function serialize(doc: Document): string {
  const xml = new XMLSerializer().serializeToString(doc);
  return xml.startsWith('<?xml') ? xml : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${xml}`;
}

/** Empties every <si> that no cell references any more, so redacted values cannot linger in the archive. */
function scrubSharedStrings(xml: string, referenced: Set<number>): string {
  const doc = parseXml(xml, 'xl/sharedStrings.xml');
  Array.from(doc.documentElement.children)
    .filter((si) => isMain(si, 'si'))
    .forEach((si, idx) => {
      if (referenced.has(idx)) return;
      while (si.firstChild) si.removeChild(si.firstChild);
      const t = doc.createElementNS(MAIN_NS, 't');
      si.append(t);
    });
  return serialize(doc);
}

/**
 * Changed cells are rewritten as inline strings so every cell keeps its own code even when
 * several cells originally shared one entry in sharedStrings.xml. Styles (the `s` attribute)
 * and every other part of the workbook are untouched, except that shared-string entries no
 * longer referenced by any cell are blanked (see scrubSharedStrings).
 */
export async function generateXlsx(doc: LoadedDocument, edits: TextEdit[]): Promise<Blob> {
  const handle = doc.handle as XlsxHandle;
  const changes = distributeEdits(handle.segments, edits);

  const perSheet = new Map<number, Map<number, string>>();
  for (const [segIdx, newText] of changes) {
    const ref = handle.cells[segIdx];
    if (!perSheet.has(ref.sheetIdx)) perSheet.set(ref.sheetIdx, new Map());
    perSheet.get(ref.sheetIdx)!.set(ref.cellIdx, newText);
  }

  const referenced = new Set<number>();
  for (const [sheetIdx, sheet] of handle.sheets.entries()) {
    const clone = sheet.doc.cloneNode(true) as Document;
    const cellChanges = perSheet.get(sheetIdx);
    if (cellChanges) {
      const cells = textCells(clone, handle.sharedStrings);
      for (const [cellIdx, value] of cellChanges) setInlineString(cells[cellIdx], value);
    }
    for (const c of Array.from(clone.getElementsByTagNameNS(MAIN_NS, 'c'))) {
      if (c.getAttribute('t') !== 's') continue;
      const idx = Number(c.getElementsByTagNameNS(MAIN_NS, 'v')[0]?.textContent ?? '');
      if (Number.isInteger(idx)) referenced.add(idx);
    }
    handle.zip.file(sheet.path, serialize(clone));
  }
  if (handle.sharedStringsXml !== null) {
    handle.zip.file('xl/sharedStrings.xml', scrubSharedStrings(handle.sharedStringsXml, referenced));
  }
  return handle.zip.generateAsync({ type: 'blob', mimeType: XLSX_MIME, compression: 'DEFLATE' });
}
