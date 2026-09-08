type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | ((e: Event) => void)> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') node.addEventListener(k.replace(/^on/, '').toLowerCase(), v);
    else if (typeof v === 'boolean') {
      if (v) node.setAttribute(k, '');
    } else if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: fileName });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

let toastHost: HTMLElement | null = null;
export function toast(message: string, kind: 'info' | 'error' | 'success' = 'info', ms = 4000): void {
  if (!toastHost) {
    toastHost = el('div', { class: 'toast-host' });
    document.body.append(toastHost);
  }
  const t = el('div', { class: `toast toast-${kind}` }, message);
  toastHost.append(t);
  setTimeout(() => t.remove(), ms);
}

let busyDepth = 0;
let busyTimer: ReturnType<typeof setTimeout> | undefined;
let busyEl: HTMLElement | null = null;

export interface BusyProgress {
  /** Completed work units. May be fractional when a task has multiple phases per file. */
  current: number;
  /** Total work units for the current task. */
  total: number;
  /** Human-readable detail shown under the progress bar. */
  detail?: string;
}

export interface BusyReporter {
  update: (progress: BusyProgress) => void;
}

export interface BusyOptions {
  /** Initial estimate used before enough work has completed to calculate a measured ETA. */
  estimatedMs?: number;
}

interface BusyState {
  label: string;
  progress?: BusyProgress;
  startedAt: number;
  estimatedMs?: number;
}

let busyState: BusyState | null = null;

function formatDuration(ms: number): string {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder === 0 ? `${minutes} 分鐘` : `${minutes} 分 ${remainder} 秒`;
}

function renderBusyState(): void {
  if (!busyEl || !busyState) return;
  const label = busyEl.querySelector<HTMLElement>('.busy-label');
  const progress = busyEl.querySelector<HTMLElement>('.busy-progress');
  const fill = busyEl.querySelector<HTMLElement>('.busy-progress-fill');
  const progressText = busyEl.querySelector<HTMLElement>('.busy-progress-text');
  const eta = busyEl.querySelector<HTMLElement>('.busy-eta');
  if (!label || !progress || !fill || !progressText || !eta) return;

  label.textContent = busyState.label;
  const p = busyState.progress;
  if (!p || p.total <= 0) {
    progress.hidden = true;
    return;
  }

  const current = Math.max(0, Math.min(p.current, p.total));
  const percent = Math.round((current / p.total) * 100);
  const elapsed = Date.now() - busyState.startedAt;
  fill.style.width = `${percent}%`;
  progress.setAttribute('aria-valuenow', String(percent));
  progress.hidden = false;
  progressText.textContent = p.detail ? `${percent}% · ${p.detail}` : `${percent}%`;

  if (current >= p.total) {
    eta.textContent = '即將完成';
  } else {
    const measuredRemaining = current > 0 && elapsed > 0 ? (elapsed / current) * (p.total - current) : undefined;
    const remaining = measuredRemaining ?? (busyState.estimatedMs === undefined ? undefined : busyState.estimatedMs - elapsed);
    eta.textContent = remaining === undefined
      ? '正在估算剩餘時間…'
      : `預估剩餘 ${formatDuration(remaining)}`;
  }
}

function createBusyElement(): HTMLElement {
  const progress = el('div', {
    class: 'busy-progress',
    role: 'progressbar',
    'aria-label': '檔案處理進度',
    'aria-valuemin': '0',
    'aria-valuemax': '100',
    'aria-valuenow': '0',
  }, el('div', { class: 'busy-progress-fill' }));
  progress.hidden = true;
  return el(
    'div',
    { class: 'busy-overlay', role: 'status', 'aria-live': 'polite' },
    el('div', { class: 'busy-box' },
      el('span', { class: 'spinner', 'aria-hidden': 'true' }),
      el('div', { class: 'busy-content' },
        el('span', { class: 'busy-label' }),
        progress,
        el('div', { class: 'busy-meta' },
          el('span', { class: 'busy-progress-text' }),
          el('span', { class: 'busy-eta' }),
        ),
      ),
    ),
  );
}

/**
 * Runs `fn` with the app made inert (no clicks, no focus) and, once it has taken more than a
 * blink, a full-screen "working" overlay so the user can see something is happening.
 * Nested calls share one overlay; the outermost label is the one shown.
 */
export async function withBusy<T>(label: string, fn: (reporter: BusyReporter) => Promise<T>, options: BusyOptions = {}): Promise<T> {
  const app = document.getElementById('app');
  const outermost = busyDepth++ === 0;
  if (outermost) {
    busyState = { label, startedAt: Date.now(), estimatedMs: options.estimatedMs };
    app?.setAttribute('inert', '');
    busyTimer = setTimeout(() => {
      if (!busyEl) {
        busyEl = createBusyElement();
        document.body.append(busyEl);
      }
      renderBusyState();
      busyEl.hidden = false;
    }, 150);
  }

  const reporter: BusyReporter = {
    update: (progress) => {
      if (!busyState) return;
      busyState.progress = progress;
      renderBusyState();
    },
  };
  try {
    return await fn(reporter);
  } finally {
    if (--busyDepth === 0) {
      clearTimeout(busyTimer);
      if (busyEl) busyEl.hidden = true;
      busyState = null;
      app?.removeAttribute('inert');
    }
  }
}

export interface DropZoneOptions {
  accept: string;
  label: string;
  hint?: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
}

export function dropZone(opts: DropZoneOptions): HTMLElement {
  const input = el('input', { type: 'file', accept: opts.accept, hidden: true, multiple: !!opts.multiple });
  input.addEventListener('change', () => {
    if (input.files?.length) opts.onFiles(Array.from(input.files));
    input.value = '';
  });
  const zone = el(
    'div',
    { class: 'dropzone', tabindex: '0', role: 'button' },
    el('div', { class: 'dropzone-label' }, opts.label),
    opts.hint ? el('div', { class: 'dropzone-hint' }, opts.hint) : null,
    input,
  );
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') input.click();
  });
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('dragover');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length) opts.onFiles(files);
  });
  return zone;
}

export function button(label: string, onClick: () => void, cls = 'btn'): HTMLButtonElement {
  return el('button', { class: cls, type: 'button', onClick: () => onClick() }, label);
}

let tipEl: HTMLElement | null = null;
/** One global tooltip for every element carrying `data-tip`; lives on <body> so scroll containers cannot clip it. */
export function installTooltips(): void {
  const show = (target: HTMLElement) => {
    if (!tipEl) {
      tipEl = el('div', { class: 'tooltip', role: 'tooltip' });
      document.body.append(tipEl);
    }
    tipEl.textContent = target.dataset.tip ?? '';
    tipEl.hidden = false;
    const r = target.getBoundingClientRect();
    const tw = tipEl.offsetWidth;
    const th = tipEl.offsetHeight;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - tw - 8));
    const top = r.bottom + 6 + th > window.innerHeight ? r.top - th - 6 : r.bottom + 6;
    tipEl.style.left = `${left}px`;
    tipEl.style.top = `${top}px`;
  };
  const hide = () => {
    if (tipEl) tipEl.hidden = true;
  };
  document.addEventListener('mouseover', (e) => {
    const t = (e.target as Element | null)?.closest<HTMLElement>('[data-tip]');
    if (t) show(t);
    else hide();
  });
  document.addEventListener('scroll', hide, true);
}
