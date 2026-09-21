import type { DocFormat, LoadedDocument, RedactionItem, TextEdit } from '../core/types';
import { MAX_FILE_BYTES } from '../core/types';
import { generatePlainText, parsePlainText } from './plaintext';

export type ParseProgress =
  | {
      stage: 'ocr-model' | 'ocr-render' | 'ocr-recognize';
      page: number;
      totalPages: number;
      progress?: number;
    }
  | {
      stage: 'xlsx-read';
      sheet: number;
      totalSheets: number;
      progress?: number;
    };

export interface ParseDocumentOptions {
  allowOcr?: boolean;
  onProgress?: (progress: ParseProgress) => void;
}

export const SUPPORTED_EXTENSIONS: Record<string, DocFormat> = {
  txt: 'txt',
  md: 'md',
  markdown: 'md',
  docx: 'docx',
  xlsx: 'xlsx',
  pdf: 'pdf',
};

export const ACCEPT_ATTR = '.txt,.md,.markdown,.docx,.xlsx,.pdf';

export function detectFormat(fileName: string): DocFormat | null {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return SUPPORTED_EXTENSIONS[ext] ?? null;
}

export function validateFile(file: File): DocFormat {
  const format = detectFormat(file.name);
  if (!format) throw new Error('不支援的檔案格式，請上傳 PDF、Excel (.xlsx)、Word (.docx)、TXT 或 Markdown');
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`檔案超過 ${MAX_FILE_BYTES / 1024 / 1024} MB 上限`);
  }
  return format;
}

export async function parseDocument(file: File, options: ParseDocumentOptions = {}): Promise<LoadedDocument> {
  const format = validateFile(file);
  switch (format) {
    case 'txt':
    case 'md':
      return parsePlainText(file, format);
    case 'docx':
      return (await import('./docx')).parseDocx(file);
    case 'xlsx':
      return (await import('./xlsx')).parseXlsx(file, options.onProgress);
    case 'pdf': {
      try {
        return await (await import('./pdf')).parsePdf(file);
      } catch (error) {
        const code = (error as Error & { code?: string }).code;
        if (!options.allowOcr || code !== 'PDF_NO_TEXT_LAYER') throw error;
        return (await import('./pdf-ocr')).parsePdfWithOcr(file, options.onProgress);
      }
    }
  }
}

export async function generateDocument(doc: LoadedDocument, edits: TextEdit[]): Promise<Blob> {
  switch (doc.format) {
    case 'txt':
    case 'md':
      return generatePlainText(doc, edits);
    case 'docx':
      return (await import('./docx')).generateDocx(doc, edits);
    case 'xlsx':
      return (await import('./xlsx')).generateXlsx(doc, edits);
    case 'pdf':
      return (await import('./pdf')).generatePdf(doc, edits);
  }
}

/**
 * Excel numeric cells are masked directly in the workbook generator as 999 rather than via
 * text markers. Keep those cells out of the mapping table so restore never advertises codes
 * that cannot exist in the generated workbook.
 */
export function redactionItemsForOutput(doc: LoadedDocument, items: RedactionItem[]): RedactionItem[] {
  if (doc.format !== 'xlsx') return items;
  const ranges = (doc.handle as { financialRanges?: { start: number; end: number }[] }).financialRanges ?? [];
  if (ranges.length === 0) return items;
  return items.filter((item) => !ranges.some((range) => item.start >= range.start && item.end <= range.end));
}

export function outputFileName(original: string, suffix: string): string {
  const dot = original.lastIndexOf('.');
  if (dot <= 0) return `${original}.${suffix}`;
  return `${original.slice(0, dot)}.${suffix}${original.slice(dot)}`;
}

export function mappingFileName(original: string): string {
  const dot = original.lastIndexOf('.');
  const base = dot <= 0 ? original : original.slice(0, dot);
  return `${base}.mapping.csv`;
}

export function formatLimitations(format: DocFormat): string | null {
  if (format === 'pdf') {
    return 'PDF 文字層依原座標處理；掃描型 PDF 會保留原始頁面影像，只覆蓋被去識別化的 OCR 區域，並加入不可見文字層以便搜尋。請逐頁校對 OCR 錯字、漏字、遮罩範圍，並另行確認附件與中繼資料。';
  }
  if (format === 'xlsx') {
    return 'Excel 輸出保留儲存格樣式與工作表結構；所有非公式數值儲存格會統一替換為 999。公式儲存格維持原樣，不會被改寫；日期格式可能依原格式顯示 999 的日期序號，公式結果、工作表名稱、註解、隱藏內容與部分中繼資料不在偵測範圍。';
  }
  if (format === 'docx') {
    return 'Word 輸出保留原有樣式與表格；文字方塊、註解等特殊區域可能未涵蓋，請以預覽為準。';
  }
  return null;
}
