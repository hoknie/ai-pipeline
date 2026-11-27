import { renderDiagram } from '../../../../lib/markdown/diagrams/renderDiagram.ts';
import type { DiagramLanguage } from '../../../../lib/markdown/diagrams/policy.ts';
import { sanitizeDiagramSvg } from '../../../../lib/markdown/diagramsSvg.ts';

/** The engine output never becomes executable HTML; only reconstructed, inert SVG is mounted. */
export function diagramView(
  host: HTMLElement,
  language: DiagramLanguage,
  source: string,
  labels: { loading: string; error: string; diagram: string },
): () => void {
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  status.textContent = labels.loading;
  host.prepend(status);
  const job = renderDiagram(language, source);
  let destroyed = false;
  void job.result
    .then((svg) => {
      if (destroyed) return;
      const safe = sanitizeDiagramSvg(svg);
      safe.setAttribute('role', 'img');
      safe.setAttribute('aria-label', `${language}: ${labels.diagram}`);
      safe.classList.add('max-w-full');
      status.replaceWith(safe);
      // Source stays available for copying and diagnosing unsupported syntax.
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = language;
      details.append(summary);
      for (const pre of Array.from(host.querySelectorAll(':scope > pre'))) details.append(pre);
      host.append(details);
    })
    .catch(() => {
      if (!destroyed) {
        status.textContent = labels.error;
        status.setAttribute('role', 'alert');
      }
    });
  return () => {
    destroyed = true;
    job.cancel();
  };
}
