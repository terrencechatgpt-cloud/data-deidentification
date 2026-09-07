import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { applyRedactions } from '../../src/core/redactor';
import { detectDocument } from '../../src/core/detector';
import { BUILTIN_PATTERNS } from '../../src/core/patterns';
import { parseMarkers } from '../../src/core/codes';
import { generateXlsx, parseXlsx } from '../../src/formats/xlsx';
import { buildXlsx, toXlsxFile } from '../helpers/xlsx-builder';

describe('financial amounts in numeric Excel cells', () => {
  it('detects labelled numeric amounts and round-trips them without touching unrelated numbers', async () => {
    const bytes = await buildXlsx({
      sheets: [{
        name: '財務資料',
        rows: [
          ['項目', '數值'],
          ['還款金額', 1234567],
          ['一般數量', 1234567],
          ['應付金額', 800.5],
          ['公式應付金額', { formula: 'B2+C2', value: 1235367.5 }],
        ],
      }],
    });
    const original = await parseXlsx(toXlsxFile(bytes, '財務資料.xlsx'));
    expect(original.text).not.toContain('1235367.5');
    const items = detectDocument(original, BUILTIN_PATTERNS);

    expect(items.filter((item) => item.category === '財務金額').map((item) => item.original)).toEqual(['1234567', '800.5']);
    expect(items.some((item) => item.original === '1234567' && item.start > original.text.indexOf('一般數量'))).toBe(false);

    const { edits, mapping } = applyRedactions(original.text, items);
    const output = await generateXlsx(original, edits);
    const restored = await parseXlsx(toXlsxFile(new Uint8Array(await output.arrayBuffer()), '財務資料.deid.xlsx'));

    expect(parseMarkers(restored.text).map((marker) => marker.category)).toEqual(['財務金額', '財務金額']);
    expect(restored.text).toContain('一般數量');
    expect(restored.text).toContain('1234567');
    expect(restored.text).not.toContain('800.5');
    expect(mapping).toHaveLength(2);

    const outputZip = await JSZip.loadAsync(await output.arrayBuffer());
    const outputSheet = await outputZip.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(outputSheet).toContain('<f>B2+C2</f>');
    expect(outputSheet).toContain('<v>1235367.5</v>');
  });
});
