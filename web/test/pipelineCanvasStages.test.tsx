// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Api } from '../src/shared/api/api.ts';
import PipelinesPage from '../src/features/pipelines/PipelinesPage.tsx';
import {
  liveSelection,
  selectedNodeId,
  selectionOfNode,
} from '../src/features/pipelines/form/canvas/canvasModel.ts';
import { draftOf } from '../src/features/pipelines/form/steps/draft.ts';
import type { EditorPipeline, PipelineStage } from '../src/shared/api/types.ts';

import { cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';
import { configView, fakeApi, pipelineOf, sourcesFor, specialistEntry } from './fixtures.ts';

vi.mock('@xyflow/react', async () => (await import('./fakeFlow.tsx')).fakeFlow());

beforeEach(() => {
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const STEPS = [
  { id: 'plan', specialist: 'plan' },
  { id: 'code', specialist: 'coder' },
];

function entry(raw: Record<string, unknown>): EditorPipeline {
  const base = {
    id: 'feature',
    level: 'project' as const,
    file: '/repo/aip/pipelines/feature.yaml',
    revision: 'rev',
    raw,
    shared_tags: [] as string[],
    own_tags: [] as string[],
  };
  return { ...base, sources: sourcesFor('pipelines', base) };
}

const scribe = { type: 'specialist', slug: 'scribe', name: 'scribe' } as const;
const system = { type: 'system' } as const;

function stage(
  id: string,
  kind: PipelineStage['kind'],
  section: PipelineStage['section'],
  over: Partial<PipelineStage> = {},
): PipelineStage {
  return {
    id,
    kind,
    section,
    name: id,
    performer: system,
    condition: null,
    status: null,
    group: null,
    ...over,
  };
}

const DELIVERY = stage('delivery', 'delivery', 'delivery');
const FULL = [
  stage('message', 'message', 'delivery', { performer: scribe, condition: 'delivery_commit' }),
  DELIVERY,
  stage('resolve', 'resolve', 'delivery', { performer: scribe, condition: 'conflict' }),
  stage('cleanup', 'cleanup', 'finish', { condition: 'not_keep' }),
];

function api(stages: PipelineStage[], raw: Record<string, unknown> = { steps: STEPS }): Api {
  const specialists = ['plan', 'coder'].map((slug) => specialistEntry(slug));
  return fakeApi({
    config: vi.fn(async () => configView({ specialists, pipelines: [entry(raw)] })),
    previewPipeline: vi.fn(async () => ({ topology: pipelineOf({ stages }), errors: [] })),
  });
}

function Page({ api }: { api: Api }) {
  const [selected, setSelected] = useState<string | null>('feature');
  return <PipelinesPage api={api} runs={[]} selected={selected} onSelect={setSelected} />;
}

const openDiagram = async () => {
  await screen.findAllByRole('listitem', { name: /^step \d+$/ });
  fireEvent.mouseDown(screen.getByRole('tab', { name: /Diagram/ }), { button: 0 });
};
const ids = () =>
  [...document.querySelectorAll<HTMLElement>('[data-testid^="canvas-node-"]')]
    .map((item) => item.dataset.testid!.replace('canvas-node-', ''))
    .filter((id) => !id.startsWith('step:'));
const inspector = () => within(screen.getByRole('complementary', { name: 'node properties' }));

describe('the system stages on the diagram', () => {
  it('shows the commit message, the resolver and the cleanup the daemon lists', async () => {
    render(<Page api={api(FULL)} />);
    await openDiagram();
    await screen.findByTestId('canvas-node-message');
    expect(ids()).toEqual([
      'start',
      'point:before_delivery',
      'message',
      'delivery',
      'point:after_delivery',
      'cleanup',
      'resolver',
    ]);
    expect(screen.getByTestId('edge-conflict:delivery->resolver').textContent).toBe('conflict');
  });

  it('shows the performer and the condition and outlines a conditional stage', async () => {
    render(<Page api={api(FULL)} />);
    await openDiagram();
    const message = await screen.findByTestId('canvas-node-message');
    expect(within(message).getByTestId('canvas-performer-message').textContent).toBe('scribe');
    expect(within(message).getByTestId('canvas-condition-message').textContent).toBe(
      'In commit mode',
    );
    expect(message.className).toContain('border-dashed');
    expect(message.className).toContain('bg-muted');
    const delivery = screen.getByTestId('canvas-node-delivery');
    expect(within(delivery).getByTestId('canvas-performer-delivery').textContent).toBe('System');
    expect(delivery.className).not.toContain('border-dashed');
    expect(screen.getByTestId('canvas-node-cleanup').textContent).toContain(
      'Unless the working directories are kept',
    );
  });

  it('names the specialist of a step node and keeps its slug as the hint', async () => {
    render(<Page api={api([DELIVERY])} />);
    await openDiagram();
    const code = (await screen.findAllByTestId(/^canvas-node-step:/)).find((item) =>
      item.textContent?.includes('CODER'),
    )!;
    const line = within(code).getByText('CODER');
    expect(line.getAttribute('title')).toBe('coder');
  });

  it('has none of them when the daemon lists no such stage', async () => {
    render(<Page api={api([DELIVERY])} />);
    await openDiagram();
    await screen.findByTestId('canvas-node-delivery');
    expect(ids()).toEqual(['start', 'point:before_delivery', 'delivery', 'point:after_delivery']);
  });

  it('captions the first node of each section', async () => {
    const raw = { split: { specialist: 'plan' }, steps: STEPS };
    render(<Page api={api(FULL, raw)} />);
    await openDiagram();
    await screen.findByTestId('canvas-node-message');
    const sectionOf = (testId: string) =>
      within(screen.getByTestId(testId)).queryByTestId(/^canvas-section-/)?.dataset.testid;
    const first = document.querySelector<HTMLElement>('[data-kind="step"]')!.dataset.testid!;
    expect(sectionOf('canvas-node-point:before_split')).toBe('canvas-section-prepare');
    expect(sectionOf(first)).toBe('canvas-section-work');
    expect(sectionOf('canvas-node-merge')).toBe('canvas-section-merge');
    expect(sectionOf('canvas-node-point:before_delivery')).toBe('canvas-section-delivery');
    expect(sectionOf('canvas-node-point:after_delivery')).toBe('canvas-section-finish');
    for (const quiet of ['canvas-node-split', 'canvas-node-message', 'canvas-node-delivery']) {
      expect(sectionOf(quiet)).toBeUndefined();
    }
    expect(screen.getByTestId('canvas-section-finish').textContent).toBe('Finish');
  });
});

describe('the inspector of a system stage', () => {
  it('describes the delivery, with its performer and a link and no fields', async () => {
    render(<Page api={api([DELIVERY])} />);
    await openDiagram();
    fireEvent.click(await screen.findByTestId('canvas-node-delivery'));
    const about = inspector().getByTestId('canvas-stage-about');
    expect(about.textContent).toContain('The system delivers the result of the run');
    expect(about.textContent).toContain('Performer: System');
    expect(inspector().getByRole('link', { name: 'Open in Pipeline' }).getAttribute('href')).toBe(
      '#pipelines/system/delivery',
    );
    expect(inspector().queryAllByRole('textbox')).toHaveLength(0);
    expect(inspector().queryAllByRole('button')).toHaveLength(0);
  });

  it('describes the merge without a link and leaves the draft alone', async () => {
    const writePipeline = vi.fn();
    const raw = { split: { specialist: 'plan' }, steps: STEPS };
    render(<Page api={{ ...api([DELIVERY], raw), writePipeline } as Api} />);
    await openDiagram();
    fireEvent.click(await screen.findByTestId('canvas-node-merge'));
    const about = inspector().getByTestId('canvas-stage-about');
    expect(about.textContent).toContain('merges the results of the groups');
    expect(about.textContent).toContain('Performer: System');
    expect(inspector().queryByRole('link')).toBeNull();
    expect(writePipeline).not.toHaveBeenCalled();
  });

  it('shows the performer and the condition of the resolver', async () => {
    render(<Page api={api(FULL)} />);
    await openDiagram();
    fireEvent.click(await screen.findByTestId('canvas-node-resolver'));
    await waitFor(() =>
      expect(inspector().getByTestId('canvas-stage-about').textContent).toContain(
        'Condition: On conflict',
      ),
    );
    expect(inspector().getByTestId('canvas-stage-about').textContent).toContain(
      'Performer: scribe',
    );
  });
});

describe('the selection of a stage', () => {
  const draft = draftOf({ steps: STEPS });

  it('is made by a click on the merge, the delivery and the resolver', () => {
    expect(selectionOfNode('merge')).toEqual({ kind: 'stage', id: 'merge' });
    expect(selectionOfNode('delivery')).toEqual({ kind: 'stage', id: 'delivery' });
    expect(selectionOfNode('resolver')).toEqual({ kind: 'stage', id: 'resolver' });
    expect(selectedNodeId({ kind: 'stage', id: 'resolver' })).toBe('resolver');
  });

  it('is dropped when the node is gone', () => {
    const resolver = { kind: 'stage', id: 'resolver' } as const;
    expect(liveSelection(resolver, draft, FULL)).toEqual(resolver);
    expect(liveSelection(resolver, draft, [DELIVERY])).toBeNull();
    expect(liveSelection(resolver, draft, null)).toBeNull();
    expect(liveSelection({ kind: 'stage', id: 'delivery' }, draft, null)).not.toBeNull();
    expect(liveSelection({ kind: 'stage', id: 'merge' }, draft, null)).toBeNull();
  });
});
