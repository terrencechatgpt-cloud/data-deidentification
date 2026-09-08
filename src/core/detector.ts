import type { Category, LoadedDocument, Pattern, RedactionItem } from './types';
import { CodeBook } from './codes';

let nextId = 1;
function newId(): string {
  return `r${nextId++}`;
}

interface Candidate {
  category: Category;
  start: number;
  end: number;
}

export function compilePattern(p: Pattern): RegExp | null {
  try {
    return new RegExp(p.regex, 'gu');
  } catch {
    return null;
  }
}

/** Longest match wins; on equal length, the earlier start wins. */
function resolveOverlaps(cands: Candidate[]): Candidate[] {
  if (cands.length === 0) return [];
  const sorted = [...cands].sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  const chosen: Candidate[] = [];
  // Chosen ranges are usually short identifiers, dates, or amounts. A byte per UTF-16 code
  // unit makes overlap checks proportional to the candidate length instead of rescanning every
  // previously accepted item (which became quadratic on large Excel files).
  let maxEnd = 0;
  for (const candidate of cands) maxEnd = Math.max(maxEnd, candidate.end);
  const occupied = new Uint8Array(maxEnd);
  for (const c of sorted) {
    let overlaps = false;
    for (let index = c.start; index < c.end; index += 1) {
      if (occupied[index]) {
        overlaps = true;
        break;
      }
    }
    if (overlaps) continue;
    for (let index = c.start; index < c.end; index += 1) occupied[index] = 1;
    chosen.push(c);
  }
  return chosen.sort((a, b) => a.start - b.start);
}

function toRedactionItem(candidate: Candidate, text: string, book: CodeBook): RedactionItem {
  const original = text.slice(candidate.start, candidate.end);
  return {
    id: newId(),
    category: candidate.category,
    original,
    start: candidate.start,
    end: candidate.end,
    code: book.codeFor(candidate.category, original),
    origin: 'auto' as const,
    active: true,
  };
}

export function detect(text: string, patterns: Pattern[], book: CodeBook = new CodeBook()): RedactionItem[] {
  const cands: Candidate[] = [];
  for (const p of patterns) {
    if (!p.enabled) continue;
    const re = compilePattern(p);
    if (!re) continue;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      // Context-aware finance/clinical rules need enough text to verify labels without
      // consuming those labels in the replacement range.
      if (p.validate && !p.validate(m[0], text.slice(Math.max(0, m.index - 80), m.index))) continue;
      cands.push({ category: p.category, start: m.index, end: m.index + m[0].length });
    }
  }
  return resolveOverlaps(cands).map((candidate) => toRedactionItem(candidate, text, book));
}

/**
 * Detects a parsed document. Excel numeric cells carry their financial-column context in the
 * workbook structure rather than in the flattened text, so labelled numeric ranges are added
 * here while formula cells remain absent from the parser metadata.
 */
export function detectDocument(doc: LoadedDocument, patterns: Pattern[], book: CodeBook = new CodeBook()): RedactionItem[] {
  const items = detect(doc.text, patterns, book);
  if (doc.format !== 'xlsx') return items;

  const amountPattern = patterns.find((p) => p.category === '財務金額' && p.enabled);
  const ranges = (doc.handle as { financialRanges?: { start: number; end: number }[] }).financialRanges ?? [];
  if (!amountPattern || ranges.length === 0) return items;

  // Numeric amount ranges already carry their financial-column context from the workbook
  // structure, so scan them with one compiled regex. Calling detect() per range used to
  // recompile the regex and linearly rescan the growing item list for every cell.
  const rangeRegex = compilePattern(amountPattern);
  if (!rangeRegex) return items;
  const existing = new Set(items.map((item) => `${item.start}:${item.end}`));
  for (const range of ranges) {
    const localText = doc.text.slice(range.start, range.end);
    rangeRegex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = rangeRegex.exec(localText)) !== null) {
      if (match[0].length === 0) {
        rangeRegex.lastIndex++;
        continue;
      }
      const start = match.index + range.start;
      const end = start + match[0].length;
      const key = `${start}:${end}`;
      if (existing.has(key)) continue;
      items.push(toRedactionItem({ category: amountPattern.category, start, end }, doc.text, book));
      existing.add(key);
    }
  }
  return items.sort((a, b) => a.start - b.start);
}

export class OverlapError extends Error {
  constructor() {
    super('選取範圍與既有項目重疊，請調整選取範圍');
  }
}

export function addManualItem(
  items: RedactionItem[],
  text: string,
  start: number,
  end: number,
  category: Category,
  book: CodeBook,
): RedactionItem {
  if (start < 0 || end > text.length || start >= end) throw new Error('選取範圍無效');
  const overlaps = items.some((it) => it.active && start < it.end && end > it.start);
  if (overlaps) throw new OverlapError();
  const original = text.slice(start, end);
  const item: RedactionItem = {
    id: newId(),
    category,
    original,
    start,
    end,
    code: book.codeFor(category, original),
    origin: 'manual',
    active: true,
  };
  const next = [...items, item].sort((a, b) => a.start - b.start);
  items.length = 0;
  items.push(...next);
  return item;
}

export function toggleItem(items: RedactionItem[], id: string): RedactionItem | undefined {
  const it = items.find((x) => x.id === id);
  if (!it) return undefined;
  if (!it.active) {
    const overlaps = items.some((o) => o.active && o.id !== id && it.start < o.end && it.end > o.start);
    if (overlaps) throw new OverlapError();
  }
  it.active = !it.active;
  return it;
}
