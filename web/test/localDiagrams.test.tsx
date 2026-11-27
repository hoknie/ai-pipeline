// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as workerPolicy from '../src/shared/api/diagrams/workerPolicy.ts';
import { renderMermaidSVG } from 'beautiful-mermaid';
import { renderDiagram } from '../src/shared/lib/markdown/diagrams/renderDiagram.ts';
import {
  disableDiagramNetwork,
  DIAGRAM_TIMEOUT,
  validateDiagramSource,
} from '../src/shared/lib/markdown/diagrams/policy.ts';
import { sanitizeDiagramSvg } from '../src/shared/lib/markdown/diagramsSvg.ts';
import { diagramView } from '../src/shared/ui/forms/markdown/diagrams/diagramView.ts';
import { MarkdownField } from '../src/shared/ui/forms/MarkdownField.tsx';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

beforeEach(() => {
  vi.spyOn(workerPolicy, 'verifyDiagramWorker').mockResolvedValue();
});

class FakeWorker {
  static latest: FakeWorker;
  static all: FakeWorker[] = [];
  onmessage?: (event: MessageEvent) => void;
  onerror?: () => void;
  onmessageerror?: () => void;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() {
    FakeWorker.latest = this;
    FakeWorker.all.push(this);
  }
}
afterEach(() => {
  cleanup();
  FakeWorker.all = [];
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('local diagram rendering', () => {
  it('renders both languages in the document without changing their fenced source', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const source =
      '```mermaid\ngraph TD\nA-->B\n```\r\n\r\n~~~plantuml\n@startuml\nA -> B\n@enduml\n~~~\r\n';
    const changed = vi.fn();
    render(<MarkdownField aria-label="Body" value={source} onChange={changed} />);
    await act(async () => {
      await Promise.resolve();
      for (const [index, worker] of FakeWorker.all.entries()) {
        worker.onmessage?.(
          new MessageEvent('message', {
            data: {
              ok: true,
              svg: `<svg xmlns="http://www.w3.org/2000/svg"><text>Diagram ${index}</text></svg>`,
            },
          }),
        );
      }
    });
    expect(FakeWorker.all).toHaveLength(2);
    expect(screen.getByRole('textbox', { name: 'Body' }).querySelectorAll('svg')).toHaveLength(2);
    expect(FakeWorker.all[0]!.postMessage).toHaveBeenCalledWith({
      language: 'mermaid',
      source: 'graph TD\nA-->B',
    });
    expect(FakeWorker.all[1]!.postMessage).toHaveBeenCalledWith({
      language: 'plantuml',
      source: '@startuml\nA -> B\n@enduml',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Markdown source' }));
    expect((screen.getByRole('textbox', { name: 'Body' }) as HTMLTextAreaElement).value).toBe(
      source.replace(/\r\n/g, '\n'), // Textarea.value normalizes line endings; the draft is untouched.
    );
    expect(changed).not.toHaveBeenCalled();
  });

  it.each([
    'graph TD\n A[Start] --> B[End]',
    'sequenceDiagram\n Alice->>Bob: Hello',
    'classDiagram\n A <|-- B',
    'stateDiagram-v2\n [*] --> Open\n Open --> Closed',
    'erDiagram\n CUSTOMER ||--o{ ORDER : places',
  ])('renders typical Mermaid syntax offline: %s', (source) => {
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    const svg = sanitizeDiagramSvg(renderMermaidSVG(source));
    expect(svg.querySelectorAll('path,polyline,rect,line').length).toBeGreaterThan(0);
    expect(svg.textContent!.trim().length).toBeGreaterThan(0);
    expect(svg.outerHTML).not.toMatch(/NaN|googleapis|@import|foreignObject|<script/);
    expect(svg.querySelector('rect')?.getAttribute('fill')).not.toContain('var(');
    expect(network).not.toHaveBeenCalled();
  });

  it('blocks network entry points and rejects source-driven resource/configuration directives', () => {
    const scope = {};
    disableDiagramNetwork(scope);
    for (const value of Object.values(Object.getOwnPropertyDescriptors(scope))) {
      expect(() => value.value('https://example.test/private')).toThrow('network');
      expect(value.writable).toBe(false);
      expect(value.configurable).toBe(false);
    }
    expect(() => validateDiagramSource('plantuml', '!include https://example.test')).toThrow();
    expect(() =>
      validateDiagramSource('plantuml', 'Alice -> Bob : <img:https://example.test>'),
    ).toThrow();
    expect(() =>
      validateDiagramSource('mermaid', '%%{init: {securityLevel: loose}}%%\ngraph TD\nA-->B'),
    ).toThrow();
    expect(() => validateDiagramSource('mermaid', 'x'.repeat(32_001))).toThrow();
  });

  it('terminates an unresponsive engine and disposes a successful engine', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    vi.useFakeTimers();
    const hung = renderDiagram('mermaid', 'graph TD\nA-->B');
    const rejected = expect(hung.result).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(DIAGRAM_TIMEOUT);
    await rejected;
    expect(FakeWorker.latest.terminate).toHaveBeenCalledOnce();
    const good = renderDiagram('plantuml', '@startuml\nAlice -> Bob\n@enduml');
    await Promise.resolve();
    FakeWorker.latest.onmessage?.(
      new MessageEvent('message', { data: { ok: true, svg: '<svg/>' } }),
    );
    expect(await good.result).toBe('<svg/>');
    expect(FakeWorker.latest.terminate).toHaveBeenCalledOnce();
  });

  it('mounts only sanitized SVG, keeps source and ignores results after disposal', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const host = document.createElement('div');
    const pre = document.createElement('pre');
    pre.textContent = 'source';
    host.append(pre);
    const labels = { loading: 'Loading', error: 'Error', diagram: 'Diagram' };
    const dispose = diagramView(host, 'mermaid', 'graph TD\nA-->B', labels);
    await Promise.resolve();
    FakeWorker.latest.onmessage?.(
      new MessageEvent('message', {
        data: {
          ok: true,
          svg: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><text>Safe</text></svg>',
        },
      }),
    );
    await Promise.resolve();
    expect(host.querySelector('svg text')?.textContent).toBe('Safe');
    expect(host.querySelector('script')).toBeNull();
    expect(host.querySelector('details pre')?.textContent).toBe('source');
    dispose();
    const other = document.createElement('div');
    const stop = diagramView(other, 'plantuml', '@startuml\nA->B\n@enduml', labels);
    await Promise.resolve();
    const worker = FakeWorker.latest;
    stop();
    worker.onmessage?.(new MessageEvent('message', { data: { ok: true, svg: '<svg/>' } }));
    await Promise.resolve();
    expect(other.querySelector('svg')).toBeNull();
  });

  it('shows a safe error and retains the source when rendering or parsing fails', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const host = document.createElement('div');
    host.textContent = 'unchanged source';
    diagramView(host, 'mermaid', 'invalid', {
      loading: 'Loading',
      error: 'Error',
      diagram: 'Diagram',
    });
    await Promise.resolve();
    FakeWorker.latest.onmessage?.(new MessageEvent('message', { data: { ok: false } }));
    await Promise.resolve();
    await Promise.resolve();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Error');
    expect(host.textContent).toContain('unchanged source');
  });
});
