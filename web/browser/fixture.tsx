import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/shared/i18n/index.ts';
import '../src/index.css';
import { MarkdownField } from '../src/shared/ui/forms/MarkdownField.tsx';
import { renderDiagram } from '../src/shared/lib/markdown/diagrams/renderDiagram.ts';
import workerUrl from '../src/shared/lib/markdown/diagrams/diagram.worker.ts?worker&url';
import probeUrl from './network.worker.ts?worker&url';

declare global {
  interface Window {
    diagramFixture: {
      workerUrl: string;
      probeUrl: string;
      hang: (language: 'mermaid' | 'plantuml') => void;
      release: () => void;
      status: string;
      terminated: number;
    };
  }
}

const api = {
  workerUrl,
  probeUrl,
  status: '',
  terminated: 0,
  release: () => {},
  hang(language: 'mermaid' | 'plantuml') {
    // Hold only delivery of the message. The production job still owns the real Worker and timer.
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      postMessage(message: unknown) {
        api.release = () => super.postMessage(message);
      }
      terminate() {
        api.terminated++;
        super.terminate();
      }
    };
    const job = renderDiagram(language, language === 'mermaid' ? 'graph TD\nA-->B' : 'A -> B');
    void job.result.then(
      () => (api.status = 'success'),
      (error: Error) => (api.status = error.message),
    );
    // Restore after construction; URL policy verification is asynchronous.
    void job.result.finally(() => (window.Worker = NativeWorker)).catch(() => {});
  },
};
window.diagramFixture = api;

function Fixture() {
  const [value, setValue] = useState('');
  return (
    <>
      <MarkdownField
        aria-label="Body"
        value={value}
        onChange={setValue}
        disabled={new URLSearchParams(window.location.search).has('locked')}
      />
      <output data-testid="draft">{value}</output>
    </>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
