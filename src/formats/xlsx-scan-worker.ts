import { scanWorksheetCells } from './xlsx';

interface ScannerRequest {
  requestId: number;
  xml: string;
  shared: string[];
}

interface ScannerResponse {
  requestId: number;
  kind: 'progress' | 'done' | 'error';
  progress?: number;
  cells?: Awaited<ReturnType<typeof scanWorksheetCells>>;
  message?: string;
}

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<ScannerRequest>) => void) | null;
  postMessage: (message: ScannerResponse) => void;
};

workerScope.onmessage = async (event) => {
  const { requestId, xml, shared } = event.data;
  try {
    const cells = await scanWorksheetCells(xml, shared, (progress) => {
      workerScope.postMessage({ requestId, kind: 'progress', progress });
    });
    workerScope.postMessage({ requestId, kind: 'done', cells });
  } catch (error) {
    workerScope.postMessage({
      requestId,
      kind: 'error',
      message: error instanceof Error ? error.message : '無法解析工作表',
    });
  }
};

export {};
