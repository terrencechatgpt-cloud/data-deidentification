import { describe, expect, it } from 'vitest';
import { detect } from '../../src/core/detector';
import { BUILTIN_PATTERNS } from '../../src/core/patterns';

function matches(id: string, text: string): string[] {
  const pattern = BUILTIN_PATTERNS.find((p) => p.id === id);
  if (!pattern) throw new Error(`pattern not found: ${id}`);
  return detect(text, [pattern]).map((item) => item.original);
}

describe('pharmaceutical document patterns', () => {
  it('detects common subject and trial identifiers', () => {
    expect(matches('pharma-subject-id', '受試者 SUBJ-TAIWAN-001，對照組 PT-0042')).toEqual([
      'SUBJ-TAIWAN-001',
      'PT-0042',
    ]);
    expect(matches('pharma-trial-id', '試驗 NCT01234567，方案 PROT-ABX-001')).toEqual([
      'NCT01234567',
      'PROT-ABX-001',
    ]);
  });

  it('detects site, batch and product identifiers', () => {
    expect(matches('pharma-site', '試驗中心：臺北榮民總醫院；北區臨床試驗中心')).toEqual([
      '臺北榮民總醫院',
      '北區臨床試驗中心',
    ]);
    expect(matches('pharma-lot', '批號：L20260908，LOT-ABX-240901')).toEqual([
      '批號：L20260908',
      'LOT-ABX-240901',
    ]);
    expect(matches('pharma-product-code', '研究藥物 ABX-101，化合物 CMPD-2409-A')).toEqual([
      'ABX-101',
      'CMPD-2409-A',
    ]);
  });

  it('requires nearby labels before masking high-risk financial and clinical numbers', () => {
    expect(matches('finance-bank-account', '銀行帳號：013123456789')).toEqual(['013123456789']);
    expect(matches('finance-bank-account', '一般數字 013123456789')).toEqual([]);
    expect(matches('finance-credit-card', '信用卡號：4111-1111-1111-1111')).toEqual(['4111-1111-1111-1111']);
    expect(matches('finance-credit-card', '測試序號 4111-1111-1111-1111')).toEqual([]);
    expect(matches('finance-amount', '還款金額：NT$ 1,234,567 元；應付金額 800.50 元')).toEqual(['1,234,567', '800.50']);
    expect(matches('finance-amount', '一般數字 1,234,567；還款日期 2026-09-08')).toEqual([]);
    expect(matches('pharma-mrn', '病歷號：2026090801')).toEqual(['2026090801']);
    expect(matches('pharma-mrn', '實驗數據 2026090801')).toEqual([]);
  });

  it('detects dates, invoice numbers and contract/procurement codes', () => {
    expect(matches('pharma-date', '簽署日 2026-09-08；出生日期：民國85年2月3日')).toEqual([
      '2026-09-08',
      '民國85年2月3日',
    ]);
    expect(matches('finance-invoice', '發票 AB12345678')).toEqual(['AB12345678']);
    expect(matches('finance-contract-code', '採購單 PO-2026-0018，合約 SC-2026-0917')).toEqual([
      'PO-2026-0018',
      'SC-2026-0917',
    ]);
  });

  it('detects common internal and supplier identifiers', () => {
    expect(matches('pharma-internal-id', '員工 STAFF-004521、供應商 VENDOR-TAIWAN-018、客戶 CUST-10001')).toEqual([
      'STAFF-004521',
      'VENDOR-TAIWAN-018',
      'CUST-10001',
    ]);
  });
});
