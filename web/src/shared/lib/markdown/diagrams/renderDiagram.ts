import { DIAGRAM_TIMEOUT, MAX_DIAGRAM_SVG, validateDiagramSource } from './policy.ts';
import type { DiagramLanguage } from './policy.ts';
import workerUrl from './diagram.worker.ts?worker&url';
import { verifyDiagramWorker } from '../../../api/diagrams/workerPolicy.ts';

export type DiagramJob = { result: Promise<string>; cancel: () => void };

/** Each render has a disposable Worker: timeouts interrupt synchronous engine loops too. */
export function renderDiagram(language: DiagramLanguage, source: string): DiagramJob {
  let stop = () => {};
  const result = new Promise<string>((resolve, reject) => {
    validateDiagramSource(language, source);
    let worker: Worker | undefined;
    let settled = false;
    const finish = (error?: Error, svg?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker?.terminate();
      if (error) reject(error);
      else resolve(svg!);
    };
    const timer = setTimeout(
      () => finish(new Error('Diagram rendering timed out')),
      DIAGRAM_TIMEOUT,
    );
    stop = () => finish(new Error('Diagram rendering cancelled'));
    void verifyDiagramWorker(workerUrl)
      .then(() => {
        if (settled) return;
        worker = new Worker(workerUrl);
        worker.onerror = () => finish(new Error('Diagram rendering failed'));
        worker.onmessageerror = () => finish(new Error('Invalid diagram response'));
        worker.onmessage = (event: MessageEvent<unknown>) => {
          const data = event.data;
          if (
            data &&
            typeof data === 'object' &&
            'ok' in data &&
            data.ok === true &&
            'svg' in data &&
            typeof data.svg === 'string' &&
            data.svg.length <= MAX_DIAGRAM_SVG
          )
            finish(undefined, data.svg);
          else finish(new Error('Diagram rendering failed'));
        };
        worker.postMessage({ language, source });
      })
      .catch(() => finish(new Error('Diagram rendering failed')));
  });
  return { result, cancel: () => stop() };
}
