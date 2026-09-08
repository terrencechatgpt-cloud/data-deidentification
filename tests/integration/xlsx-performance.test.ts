import { describe, expect, it, vi } from 'vitest';
import { parseXlsx } from '../../src/formats/xlsx';
import { buildXlsx, toXlsxFile } from '../helpers/xlsx-builder';

describe('xlsx parsing performance', () => {
  it('parses a large labelled financial worksheet without quadratic slowdown', async () => {
    const rows: (string | number)[][] = [['日期', '還款金額']];
    for (let i = 0; i < 2000; i++) rows.push([`2026/09/${String((i % 28) + 1).padStart(2, '0')}`, i * 1000]);
    const file = toXlsxFile(await buildXlsx({ sheets: [{ name: '還款明細', rows }] }), '大型還款明細.xlsx');

    const originalLookup = Document.prototype.getElementsByTagNameNS;
    let worksheetLookups = 0;
    const lookupSpy = vi.spyOn(Document.prototype, 'getElementsByTagNameNS').mockImplementation(function (this: Document, namespaceURI, localName) {
      if (localName === 'c') worksheetLookups++;
      return originalLookup.call(this, namespaceURI, localName);
    });
    const startedAt = performance.now();
    const doc = await parseXlsx(file);
    const elapsedMs = performance.now() - startedAt;
    lookupSpy.mockRestore();

    expect(doc.text).toContain('還款金額');
    expect(doc.text).toContain('1999000');
    expect(worksheetLookups).toBeLessThan(10);
    expect(elapsedMs).toBeLessThan(5000);
  }, 15000);
});
