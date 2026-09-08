import { describe, expect, it } from 'vitest';
import { withBusy } from '../../src/ui/components';

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('withBusy', () => {
  it('locks #app for the whole task and shows the overlay once the task turns out to be slow', async () => {
    document.body.innerHTML = '<div id="app"><button>x</button></div>';
    const app = document.getElementById('app')!;
    let finish!: () => void;
    const run = withBusy('載入範例中…', () => new Promise<void>((r) => (finish = r)));

    expect(app.hasAttribute('inert')).toBe(true);
    await tick(200);
    const overlay = document.querySelector<HTMLElement>('.busy-overlay')!;
    expect(overlay.hidden).toBe(false);
    expect(overlay.textContent).toContain('載入範例中…');

    finish();
    await run;
    expect(app.hasAttribute('inert')).toBe(false);
    expect(overlay.hidden).toBe(true);
  });

  it('does not flash the overlay for a task that finishes quickly, and unlocks even when it throws', async () => {
    const app = document.getElementById('app')!;
    await expect(withBusy('讀取檔案中…', () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(app.hasAttribute('inert')).toBe(false);
    await tick(200);
    expect(document.querySelector<HTMLElement>('.busy-overlay')!.hidden).toBe(true);
  });

  it('renders progress details and an estimated remaining time for slow tasks', async () => {
    const app = document.getElementById('app')!;
    let finish!: () => void;
    const run = withBusy('處理檔案中…', async ({ update }) => {
      update({ current: 1, total: 4, detail: '正在讀取第 1 / 2 個檔案' });
      await tick(200);
      update({ current: 2, total: 4, detail: '正在偵測第 1 / 2 個檔案' });
      await new Promise<void>((resolve) => { finish = resolve; });
    }, { estimatedMs: 4000 });

    await tick(200);
    const overlay = document.querySelector<HTMLElement>('.busy-overlay')!;
    const progress = overlay.querySelector<HTMLElement>('.busy-progress')!;
    expect(app.hasAttribute('inert')).toBe(true);
    expect(progress.hidden).toBe(false);
    expect(progress.getAttribute('aria-valuenow')).toBe('50');
    expect(overlay.querySelector('.busy-progress-text')?.textContent).toContain('正在偵測第 1 / 2 個檔案');
    expect(overlay.querySelector('.busy-eta')?.textContent).toContain('預估剩餘');

    finish();
    await run;
    expect(app.hasAttribute('inert')).toBe(false);
  });
});
