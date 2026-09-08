import JSZip from 'jszip';
import type { LoadedDocument, TextEdit, XlsxCellLayout } from '../core/types';
import { distributeEdits, type Segment } from './segments';
import type { ParseProgress } from './index';

const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

interface CellRef {
  sheetIdx: number;
  /** Index into the sheet's detectable cell list (document order). */
  cellIdx: number;
}

interface SheetInfo {
  path: string;
  /** The original worksheet XML, retained so generation can rewrite only changed cells. */
  xml: string;
  /** Every cell in document order, including formulas and cells that are not detectable. */
  allCells: CellInfo[];
  /** Text cells plus labelled financial numeric cells, in document order. */
  detectableCells: CellInfo[];
}

interface CellInfo {
  start: number;
  end: number;
  type: string | null;
  formula: boolean;
  string: boolean;
  numeric: boolean;
  text: string;
  row: number;
  col: number;
  sharedIndex: number | null;
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
  // Most Excel strings are a simple <si><t>…</t></si> or <is><t>…</t></is>. Avoid a
  // recursive DOM walk for that common case; only walk when phonetic hints must be excluded.
  if (!Array.from(el.children).some((child) => isMain(child, 'rPh'))) return el.textContent ?? '';
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

function decodeXmlText(value: string): string {
  if (!value.includes('&')) return value;
  return value
    .replace(/&#x([0-9a-f]+);/giu, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Extracts visible text from one <si> while ignoring phonetic hints and preserving rich text runs. */
function visibleSharedString(body: string): string {
  let out = '';
  let searchFrom = 0;
  while (searchFrom < body.length) {
    const start = body.indexOf('<t', searchFrom);
    if (start < 0) break;
    const marker = body[start + 2];
    if (marker !== undefined && !/[\s/>]/.test(marker)) {
      searchFrom = start + 2;
      continue;
    }
    const openEnd = body.indexOf('>', start + 2);
    if (openEnd < 0) break;
    const close = body.indexOf('</t', openEnd + 1);
    if (close < 0) break;
    const phoneticStart = body.lastIndexOf('<rPh', start);
    const phoneticEnd = body.lastIndexOf('</rPh', start);
    if (phoneticStart <= phoneticEnd) out += decodeXmlText(body.slice(openEnd + 1, close));
    searchFrom = close + 4;
  }
  return out;
}

/** Reads shared strings in one linear pass; DOM parsing every <si> is prohibitively slow for large workbooks. */
function parseSharedStringsXml(xml: string): string[] | null {
  const values: string[] = [];
  let searchFrom = 0;
  while (searchFrom < xml.length) {
    const start = xml.indexOf('<si', searchFrom);
    if (start < 0) break;
    const marker = xml[start + 3];
    if (marker !== undefined && !/[\s/>]/.test(marker)) {
      searchFrom = start + 3;
      continue;
    }
    const openEnd = xml.indexOf('>', start + 3);
    if (openEnd < 0) return null;
    const close = xml.indexOf('</si', openEnd + 1);
    if (close < 0) return null;
    values.push(visibleSharedString(xml.slice(openEnd + 1, close)));
    const closeEnd = xml.indexOf('>', close + 4);
    searchFrom = closeEnd < 0 ? xml.length : closeEnd + 1;
  }
  return values.length > 0 ? values : null;
}

function parseXml(xml: string, path: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) throw new Error(`無法解析 ${path}`);
  return doc;
}

async function loadSharedStrings(zip: JSZip): Promise<{ values: string[]; xml: string | null }> {
  const file = zip.file('xl/sharedStrings.xml');
  if (!file) return { values: [], xml: null };
  const xml = await file.async('string');
  const values = parseSharedStringsXml(xml);
  if (values !== null) return { values, xml };
  const doc = parseXml(xml, 'xl/sharedStrings.xml');
  return {
    values: Array.from(doc.documentElement.children).filter((si) => isMain(si, 'si')).map(textOf),
    xml,
  };
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
function buildFinancialLabelIndex(cells: CellInfo[]): FinancialLabelIndex {
  const labelRows = new Set<number>();
  const earliestLabelRowByCol = new Map<number, number>();
  for (const candidate of cells) {
    if (candidate.formula || !candidate.string || !hasFinancialLabel(candidate.text)) continue;
    labelRows.add(candidate.row);
    const existing = earliestLabelRowByCol.get(candidate.col);
    if (existing === undefined || candidate.row < existing) earliestLabelRowByCol.set(candidate.col, candidate.row);
  }
  return { labelRows, earliestLabelRowByCol };
}

function isFinancialNumericCell(c: CellInfo, labels: FinancialLabelIndex): boolean {
  if (!c.numeric || c.formula) return false;
  return labels.labelRows.has(c.row) || (labels.earliestLabelRowByCol.get(c.col) ?? Number.POSITIVE_INFINITY) < c.row;
}

function xmlAttributeValue(tag: string, name: string): string | null {
  let cursor = 1;
  while (cursor < tag.length && !/[\s/>]/.test(tag[cursor])) cursor += 1;
  while (cursor < tag.length) {
    while (cursor < tag.length && /\s/.test(tag[cursor])) cursor += 1;
    if (cursor >= tag.length || tag[cursor] === '>' || tag[cursor] === '/') return null;
    const nameStart = cursor;
    while (cursor < tag.length && !/[\s=/>]/.test(tag[cursor])) cursor += 1;
    const attributeName = tag.slice(nameStart, cursor);
    while (cursor < tag.length && /\s/.test(tag[cursor])) cursor += 1;
    if (tag[cursor] !== '=') {
      while (cursor < tag.length && tag[cursor] !== '>' && tag[cursor] !== '/') cursor += 1;
      continue;
    }
    cursor += 1;
    while (cursor < tag.length && /\s/.test(tag[cursor])) cursor += 1;
    const quote = tag[cursor];
    if (quote !== '"' && quote !== "'") continue;
    cursor += 1;
    const valueStart = cursor;
    const valueEnd = tag.indexOf(quote, valueStart);
    if (valueEnd < 0) return null;
    if (attributeName === name) return decodeXmlText(tag.slice(valueStart, valueEnd));
    cursor = valueEnd + 1;
  }
  return null;
}

function findXmlTag(source: string, name: string, from: number): number {
  let cursor = from;
  while (cursor < source.length) {
    const start = source.indexOf(`<${name}`, cursor);
    if (start < 0) return -1;
    const marker = source[start + name.length + 1];
    if (marker === undefined || /[\s/>]/.test(marker)) return start;
    cursor = start + name.length + 1;
  }
  return -1;
}

function xmlChild(source: string, name: string): { present: boolean; value: string } {
  const start = findXmlTag(source, name, 0);
  if (start < 0) return { present: false, value: '' };
  const openEnd = source.indexOf('>', start + name.length + 1);
  if (openEnd < 0) return { present: false, value: '' };
  if (/\/\s*>$/.test(source.slice(start, openEnd + 1))) return { present: true, value: '' };
  const close = source.indexOf(`</${name}`, openEnd + 1);
  if (close < 0) return { present: false, value: '' };
  // Keep the child XML raw. Inline strings may contain escaped text that looks like XML after
  // decoding (for example the literal text "</t>"); visibleSharedString decodes each text node
  // only after locating its real closing tag.
  return { present: true, value: source.slice(openEnd + 1, close) };
}

/** Reads worksheet cells in one linear pass without constructing a DOM for the whole sheet. */
async function scanWorksheetCells(
  xml: string,
  shared: string[],
  onProgress?: (progress: number) => void,
): Promise<CellInfo[]> {
  const cells: CellInfo[] = [];
  let searchFrom = 0;
  while (searchFrom < xml.length) {
    const start = findXmlTag(xml, 'c', searchFrom);
    if (start < 0) break;
    const openEnd = xml.indexOf('>', start + 2);
    if (openEnd < 0) throw new Error('無法解析工作表儲存格');
    const openTag = xml.slice(start, openEnd + 1);
    const selfClosing = /\/\s*>$/.test(openTag);
    let end = openEnd + 1;
    let body = '';
    if (!selfClosing) {
      const close = xml.indexOf('</c', end);
      const closeEnd = close < 0 ? -1 : xml.indexOf('>', close + 3);
      if (close < 0 || closeEnd < 0) throw new Error('無法解析工作表儲存格');
      body = xml.slice(end, close);
      end = closeEnd + 1;
    }

    const type = xmlAttributeValue(openTag, 't');
    const ref = xmlAttributeValue(openTag, 'r') ?? '';
    const formula = xmlChild(body, 'f').present;
    const value = xmlChild(body, 'v');
    const inline = xmlChild(body, 'is');
    const string = type === 's' || type === 'inlineStr';
    const numeric = (type === null || type === 'n') && value.present;
    const coords = string || numeric ? cellCoords(ref) : { row: 0, col: 0 };
    let text = '';
    let sharedIndex: number | null = null;
    if (!formula) {
      if (type === 's') {
        const idx = Number(value.value);
        if (Number.isInteger(idx)) {
          sharedIndex = idx;
          text = shared[idx] ?? '';
        }
      } else if (type === 'inlineStr') {
        text = visibleSharedString(inline.value);
      } else if (numeric) {
        text = value.value;
      }
    }
    cells.push({ start, end, type, formula, string, numeric, text, sharedIndex, ...coords });
    searchFrom = end;
    if (onProgress && (cells.length === 1 || cells.length % 500 === 0 || searchFrom >= xml.length)) {
      onProgress(xml.length === 0 ? 1 : searchFrom / xml.length);
      await yieldToBrowser();
    }
  }
  onProgress?.(1);
  return cells;
}

/** Detectable value cells in document order: text cells and labelled, non-formula numeric cells. */
function textCells(cells: CellInfo[]): CellInfo[] {
  const labels = buildFinancialLabelIndex(cells);
  return cells.filter((c) => !c.formula && (c.string || isFinancialNumericCell(c, labels)));
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function parseXlsx(file: File, onProgress?: (progress: ParseProgress) => void): Promise<LoadedDocument> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  onProgress?.({ stage: 'xlsx-read', sheet: 0, totalSheets: 0, progress: 0.08 });
  const paths = await sheetPaths(zip);
  if (paths.length === 0) throw new Error('不是有效的 Excel (.xlsx) 檔案');
  const sharedTable = await loadSharedStrings(zip);
  const shared = sharedTable.values;
  onProgress?.({ stage: 'xlsx-read', sheet: 0, totalSheets: paths.length, progress: 0.18 });

  const sheets: SheetInfo[] = [];
  const segments: Segment[] = [];
  const cells: CellRef[] = [];
  const layoutSheets: { name: string; cells: XlsxCellLayout[] }[] = [];
  const financialRanges: { start: number; end: number }[] = [];
  let text = '';

  for (const [sheetIdx, { path, name }] of paths.entries()) {
    const reportSheetProgress = (phase: number) => {
      onProgress?.({
        stage: 'xlsx-read',
        sheet: sheetIdx + 1,
        totalSheets: paths.length,
        progress: Math.min(0.99, 0.18 + ((sheetIdx + Math.max(0, Math.min(1, phase))) / paths.length) * 0.82),
      });
    };
    reportSheetProgress(0);
    await yieldToBrowser();
    const xml = await zip.file(path)!.async('string');
    const layoutCells: XlsxCellLayout[] = [];
    let lastRow = '';
    const allCells = await scanWorksheetCells(xml, shared, (progress) => reportSheetProgress(0.04 + progress * 0.56));
    const detectedCells = textCells(allCells);
    sheets.push({ path, xml, allCells, detectableCells: detectedCells });
    for (const [cellIdx, cell] of detectedCells.entries()) {
      const t = cell.text;
      if (t.length > 0) {
        const row = String(cell.row);
        if (text.length > 0 && !text.endsWith('\n')) text += row === lastRow ? '\t' : '\n';
        lastRow = row;
        const coords = { row: cell.row, col: cell.col };
        segments.push({ start: text.length, end: text.length + t.length, text: t });
        layoutCells.push({ start: text.length, end: text.length + t.length, ...coords });
        if (cell.numeric) financialRanges.push({ start: text.length, end: text.length + t.length });
        cells.push({ sheetIdx, cellIdx });
        text += t;
      }
      if (cellIdx === detectedCells.length - 1 || (cellIdx + 1) % 500 === 0) {
        reportSheetProgress(0.6 + (detectedCells.length === 0 ? 0.4 : ((cellIdx + 1) / detectedCells.length) * 0.4));
        await yieldToBrowser();
      }
    }
    layoutSheets.push({ name, cells: layoutCells });
    if (!text.endsWith('\n')) text += '\n';
    text += '\n';
  }

  const sharedStringsXml = sharedTable.xml;
  const handle: XlsxHandle = { zip, sheets, sharedStrings: shared, financialRanges, sharedStringsXml, segments, cells };
  return { fileName: file.name, format: 'xlsx', text, handle, layout: { kind: 'xlsx', sheets: layoutSheets } };
}

function escapeXmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function rewriteCellXml(cellXml: string, value: string): string {
  const openEnd = cellXml.indexOf('>');
  if (openEnd < 0) return cellXml;
  let openTag = cellXml.slice(0, openEnd + 1).replace(/\/\s*>$/, '>');
  const typeAttribute = /\s+t\s*=\s*(["'])[^"']*\1/i;
  if (typeAttribute.test(openTag)) openTag = openTag.replace(typeAttribute, ' t="inlineStr"');
  else openTag = `${openTag.slice(0, -1)} t="inlineStr">`;
  return `${openTag}<is><t xml:space="preserve">${escapeXmlText(value)}</t></is></c>`;
}

/** Empties every <si> that no cell references any more, so redacted values cannot linger in the archive. */
function scrubSharedStrings(xml: string, referenced: Set<number>): string {
  let out = '';
  let searchFrom = 0;
  let index = 0;
  while (searchFrom < xml.length) {
    const start = findXmlTag(xml, 'si', searchFrom);
    if (start < 0) return index === 0 ? xml : out + xml.slice(searchFrom);
    const openEnd = xml.indexOf('>', start + 3);
    if (openEnd < 0) return xml;
    const close = xml.indexOf('</si', openEnd + 1);
    const closeEnd = close < 0 ? -1 : xml.indexOf('>', close + 4);
    if (close < 0 || closeEnd < 0) return xml;
    out += xml.slice(searchFrom, start);
    if (referenced.has(index)) out += xml.slice(start, closeEnd + 1);
    else out += `${xml.slice(start, openEnd + 1)}<t></t>${xml.slice(close, closeEnd + 1)}`;
    index += 1;
    searchFrom = closeEnd + 1;
  }
  return index === 0 ? xml : out;
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
    const cellChanges = perSheet.get(sheetIdx);
    let sheetXml = sheet.xml;
    const changedStarts = new Set<number>();
    if (cellChanges) {
      const replacements = Array.from(cellChanges.entries())
        .map(([cellIdx, value]) => {
          const cell = sheet.detectableCells[cellIdx];
          if (!cell) return null;
          changedStarts.add(cell.start);
          return { start: cell.start, end: cell.end, value };
        })
        .filter((replacement): replacement is { start: number; end: number; value: string } => replacement !== null)
        .sort((a, b) => b.start - a.start);
      for (const replacement of replacements) {
        sheetXml = `${sheetXml.slice(0, replacement.start)}${rewriteCellXml(
          sheetXml.slice(replacement.start, replacement.end),
          replacement.value,
        )}${sheetXml.slice(replacement.end)}`;
      }
    }
    for (const cell of sheet.allCells) {
      if (cell.type !== 's' || cell.sharedIndex === null || changedStarts.has(cell.start)) continue;
      referenced.add(cell.sharedIndex);
    }
    if (sheetXml !== sheet.xml) handle.zip.file(sheet.path, sheetXml);
  }
  if (handle.sharedStringsXml !== null) {
    handle.zip.file('xl/sharedStrings.xml', scrubSharedStrings(handle.sharedStringsXml, referenced));
  }
  return handle.zip.generateAsync({ type: 'blob', mimeType: XLSX_MIME, compression: 'DEFLATE' });
}
