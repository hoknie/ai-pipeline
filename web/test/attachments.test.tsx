// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/app/App.tsx';
import { AttachmentsTab } from '../src/features/runs/files/AttachmentsTab.tsx';
import { fieldsOf, emptyDraft, draftOf, draftValid } from '../src/features/queue/QueueForm.tsx';
import type { AttachmentView, QueueFields } from '../src/shared/api/types.ts';

import {
  FakeEventSource,
  fakeApi,
  groupView,
  openFake,
  queueItem,
  queueOf,
  runView,
} from './fixtures.ts';
import { act, cleanup, fireEvent, openTab, render, screen, waitFor, within } from './render.tsx';

beforeEach(() => {
  window.location.hash = '#queue';
  window.localStorage.clear();
});
afterEach(() => cleanup());

const file = (name: string, size = 10) => {
  const created = new File(['x'], name);
  Object.defineProperty(created, 'size', { value: size });
  return created;
};

const attachment = (over: Partial<AttachmentView> = {}): AttachmentView => ({
  id: 'a1',
  fileName: 'shot.png',
  size: 2048,
  mediaType: 'image/png',
  ...over,
});

async function openDialog(api = fakeApi({ queue: vi.fn(async () => queueOf()) })) {
  render(<App api={api} openStream={openFake} />);
  const strip = within(screen.getAllByRole('banner')[0]!);
  const button = strip.getByRole<HTMLButtonElement>('button', { name: 'New task' });
  await waitFor(() => expect(button.disabled).toBe(false));
  fireEvent.click(button);
  const dialog = await screen.findByRole('dialog', { name: 'New task' });
  await screen.findByLabelText('Task text');
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'Pipeline' }).textContent).toBe('feature'),
  );
  fireEvent.change(within(dialog).getByLabelText('Task text'), { target: { value: 'Work' } });
  return { api, dialog: within(dialog) };
}

const pick = (dialog: ReturnType<typeof within>, ...files: File[]) =>
  fireEvent.change(dialog.getByTestId('new-attachments-input'), { target: { files } });

describe('attachments in the new task form', () => {
  it('uploads the picked files at once, shows them and submits their ids', async () => {
    const { api, dialog } = await openDialog();
    pick(dialog, file('shot.png', 2048), file('spec.pdf', 3 * 1024 * 1024));
    await waitFor(() => expect(api.uploadAttachment).toHaveBeenCalledTimes(2));
    const list = within(await dialog.findByRole('list', { name: 'Files of the task' }));
    expect(list.getByText('shot.png')).toBeTruthy();
    expect(list.getByText('2 KB')).toBeTruthy();
    expect(list.getByText('3 MB')).toBeTruthy();
    const add = dialog.getByRole<HTMLButtonElement>('button', { name: 'Add' });
    await waitFor(() => expect(add.disabled).toBe(false));
    fireEvent.click(add);
    await waitFor(() =>
      expect(api.queueAdd).toHaveBeenCalledWith({
        pipeline: 'feature',
        task: 'Work',
        uploads: ['up-shot.png', 'up-spec.pdf'],
      }),
    );
  });

  it('clears the files from the draft after the task is added', async () => {
    const { dialog } = await openDialog();
    pick(dialog, file('shot.png'));
    const add = dialog.getByRole<HTMLButtonElement>('button', { name: 'Add' });
    await waitFor(() => expect(add.disabled).toBe(false));
    fireEvent.click(add);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New task' })).toBeNull());
    const strip = within(screen.getAllByRole('banner')[0]!);
    fireEvent.click(strip.getByRole('button', { name: 'New task' }));
    const again = within(await screen.findByRole('dialog', { name: 'New task' }));
    expect(again.queryByText('shot.png')).toBeNull();
  });

  it('keeps the files in the draft while the dialog is closed', async () => {
    const { dialog } = await openDialog();
    pick(dialog, file('shot.png'));
    await dialog.findByText('shot.png');
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'New task' }), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New task' })).toBeNull());
    const strip = within(screen.getAllByRole('banner')[0]!);
    fireEvent.click(strip.getByRole('button', { name: 'New task' }));
    const again = within(await screen.findByRole('dialog', { name: 'New task' }));
    expect(await again.findByText('shot.png')).toBeTruthy();
  });

  it('refuses a file over 20 MB, the 11th file and a repeated name, with a message', async () => {
    const { api, dialog } = await openDialog();
    pick(dialog, file('big.bin', 30 * 1024 * 1024));
    expect((await dialog.findByRole('alert')).textContent).toBe('big.bin is larger than 20 MB');
    expect(dialog.queryByText('big.bin', { selector: 'span' })).toBeNull();
    expect(api.uploadAttachment).not.toHaveBeenCalled();

    pick(dialog, file('a.txt'));
    await dialog.findByText('a.txt');
    pick(dialog, file('a.txt'));
    expect((await dialog.findByRole('alert')).textContent).toBe('a.txt is already attached');
    expect(api.uploadAttachment).toHaveBeenCalledTimes(1);

    pick(dialog, ...Array.from({ length: 10 }, (_, index) => file(`f${index}.txt`)));
    expect((await dialog.findByRole('alert')).textContent).toBe(
      'A task has at most 10 attachments',
    );
    const list = within(dialog.getByRole('list', { name: 'Files of the task' }));
    expect(list.getAllByRole('listitem')).toHaveLength(10);
  });

  it('takes files dropped on the field', async () => {
    const { api, dialog } = await openDialog();
    const zone = document.querySelector('[data-dropzone]')!;
    fireEvent.drop(zone, { dataTransfer: { files: [file('drop.log')] } });
    await waitFor(() => expect(api.uploadAttachment).toHaveBeenCalledTimes(1));
    expect(await dialog.findByText('drop.log')).toBeTruthy();
  });

  it('blocks Add while a file is being sent and shows its progress', async () => {
    let finish: (value: { upload: string; fileName: string; size: number }) => void = () => {};
    let progress: (percent: number) => void = () => {};
    const api = fakeApi({
      queue: vi.fn(async () => queueOf()),
      uploadAttachment: vi.fn(
        (_file: File, onProgress?: (percent: number) => void) =>
          new Promise<{ upload: string; fileName: string; size: number }>((resolve) => {
            finish = resolve;
            progress = onProgress ?? (() => {});
          }),
      ),
    });
    const { dialog } = await openDialog(api);
    pick(dialog, file('slow.bin'));
    const add = dialog.getByRole<HTMLButtonElement>('button', { name: 'Add' });
    await dialog.findByText('slow.bin');
    expect(add.disabled).toBe(true);
    act(() => progress(40));
    expect(dialog.getByRole<HTMLProgressElement>('progressbar').value).toBe(40);
    fireEvent.submit(add.closest('form')!);
    expect(api.queueAdd).not.toHaveBeenCalled();
    act(() => finish({ upload: 'u1', fileName: 'slow.bin', size: 10 }));
    await waitFor(() => expect(add.disabled).toBe(false));
  });

  it('shows an upload error at the file and sends the task without that file', async () => {
    const api = fakeApi({
      queue: vi.fn(async () => queueOf()),
      uploadAttachment: vi.fn(async (picked: File) => {
        if (picked.name === 'bad.png') throw new Error('disk full');
        return { upload: `up-${picked.name}`, fileName: picked.name, size: 1 };
      }),
    });
    const { dialog } = await openDialog(api);
    pick(dialog, file('bad.png'), file('good.png'));
    expect((await dialog.findByText('Upload failed: disk full')).getAttribute('role')).toBe(
      'alert',
    );
    const add = dialog.getByRole<HTMLButtonElement>('button', { name: 'Add' });
    await waitFor(() => expect(add.disabled).toBe(false));
    fireEvent.click(add);
    await waitFor(() =>
      expect(api.queueAdd).toHaveBeenCalledWith({
        pipeline: 'feature',
        task: 'Work',
        uploads: ['up-good.png'],
      }),
    );
  });

  it('removes a picked file from the list', async () => {
    const { api, dialog } = await openDialog();
    pick(dialog, file('a.txt'), file('b.txt'));
    await dialog.findByText('b.txt');
    fireEvent.click(dialog.getByRole('button', { name: 'Remove a.txt' }));
    expect(dialog.queryByText('a.txt')).toBeNull();
    const add = dialog.getByRole<HTMLButtonElement>('button', { name: 'Add' });
    await waitFor(() => expect(add.disabled).toBe(false));
    fireEvent.click(add);
    await waitFor(() =>
      expect(api.queueAdd).toHaveBeenCalledWith(expect.objectContaining({ uploads: ['up-b.txt'] })),
    );
  });
});

describe('the draft of attachments', () => {
  it('sends uploads and detach only when there are some', () => {
    const empty = fieldsOf({ ...emptyDraft('feature'), task: 'x' });
    expect('uploads' in empty).toBe(false);
    expect('detach' in empty).toBe(false);
    const fields: QueueFields = fieldsOf({
      ...emptyDraft('feature'),
      task: 'x',
      attachments: [
        { key: 'k1', fileName: 'a', size: 1, progress: 100, upload: 'u1', error: null },
        { key: 'k2', fileName: 'b', size: 1, progress: 0, upload: null, error: 'x' },
        { key: 'k3', fileName: 'c', size: 1, progress: 10, upload: null, error: null },
      ],
      detached: ['old.png'],
    });
    expect(fields).toMatchObject({ uploads: ['u1'], detach: ['old.png'] });
  });

  it('is not valid while a file is on its way', () => {
    const draft = { ...emptyDraft('feature'), task: 'x' };
    expect(draftValid(draft)).toBe(true);
    const sending = {
      key: 'k',
      fileName: 'a',
      size: 1,
      progress: 5,
      upload: null,
      error: null,
    };
    expect(draftValid({ ...draft, attachments: [sending] })).toBe(false);
    expect(draftValid({ ...draft, attachments: [{ ...sending, error: 'x' }] })).toBe(true);
  });

  it('takes the attachments of an item for editing', () => {
    const item = queueItem('q1', 'work', 1, { attachments: [attachment()] });
    expect(draftOf(item).existing).toEqual([attachment()]);
    expect(draftOf(queueItem('q2', 'work', 2)).existing).toBeUndefined();
  });
});

describe('attachments of a queued item', () => {
  const withItem = (extra = {}) => {
    const items = [queueItem('q1', 'work', 1, extra)];
    return fakeApi({ queue: vi.fn(async () => queueOf({ items })) });
  };

  it('shows a paperclip with the number in the row, only when there are files', async () => {
    const items = [
      queueItem('q1', 'first', 1, { attachments: [attachment(), attachment({ id: 'a2' })] }),
      queueItem('q2', 'second', 2),
    ];
    render(
      <App api={fakeApi({ queue: vi.fn(async () => queueOf({ items })) })} openStream={openFake} />,
    );
    const list = await screen.findByRole('list', { name: 'tasks in the queue' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]!.querySelector('[data-attachments]')?.textContent).toBe('2');
    expect(rows[1]!.querySelector('[data-attachments]')).toBeNull();
  });

  it('removes an attachment in the edit form and sends its name', async () => {
    const api = withItem({
      attachments: [attachment(), attachment({ id: 'a2', fileName: 'b.txt' })],
    });
    render(<App api={api} openStream={openFake} />);
    const list = await screen.findByRole('list', { name: 'tasks in the queue' });
    fireEvent.click(within(list).getByRole('button', { name: 'Edit' }));
    const row = within(within(list).getAllByRole('listitem')[0]!);
    fireEvent.click(await row.findByRole('button', { name: 'Remove shot.png' }));
    fireEvent.click(row.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.queueEdit).toHaveBeenCalledWith(
        'q1',
        expect.objectContaining({ detach: ['shot.png'] }),
      ),
    );
  });

  it('attaches a new file in the edit form', async () => {
    const api = withItem({ attachments: [attachment()] });
    render(<App api={api} openStream={openFake} />);
    const list = await screen.findByRole('list', { name: 'tasks in the queue' });
    fireEvent.click(within(list).getByRole('button', { name: 'Edit' }));
    const row = within(within(list).getAllByRole('listitem')[0]!);
    fireEvent.change(await row.findByTestId('edit-q1-attachments-input'), {
      target: { files: [file('new.png')] },
    });
    const save = row.getByRole<HTMLButtonElement>('button', { name: 'Save' });
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);
    await waitFor(() =>
      expect(api.queueEdit).toHaveBeenCalledWith(
        'q1',
        expect.objectContaining({ uploads: ['up-new.png'] }),
      ),
    );
  });

  it('shows the files of a returned run without a way to change them', async () => {
    const api = withItem({ run: 'r1', title: 'Логин', attachments: [attachment()] });
    render(<App api={api} openStream={openFake} />);
    const list = await screen.findByRole('list', { name: 'tasks in the queue' });
    fireEvent.click(within(list).getByRole('button', { name: 'Edit' }));
    const row = within(within(list).getAllByRole('listitem')[0]!);
    await waitFor(() => expect(row.getAllByText('shot.png').length).toBeGreaterThan(0));
    expect(row.queryByTestId('edit-q1-attachments-input')).toBeNull();
    expect(row.queryByRole('button', { name: 'Remove shot.png' })).toBeNull();
  });
});

function showRun(run = runView()) {
  window.location.hash = '#runs/run1/login';
  const api = fakeApi({ group: vi.fn(async () => groupView()) });
  render(<App api={api} openStream={openFake} />);
  act(() => FakeEventSource.last!.send({ event: 'snapshot', seq: 1, runs: [run] }));
  return api;
}

describe('attachments of a run', () => {
  it('has no tab and no clip for a run without attachments', async () => {
    showRun();
    await screen.findByRole('tab', { name: 'Log' });
    expect(screen.queryByRole('tab', { name: /Attachments/ })).toBeNull();
    expect(document.querySelector('[data-run] [data-attachments]')).toBeNull();
  });

  it('has the tab with the number and a clip on the card when there are attachments', async () => {
    showRun(runView({ attachments: [attachment(), attachment({ id: 'a2', fileName: 'b.txt' })] }));
    const tab = await screen.findByRole('tab', { name: 'Attachments · 2' });
    expect(document.querySelector('[data-run] [data-attachments]')?.textContent).toBe('2');
    openTab(tab.textContent ?? 'Attachments · 2');
    await waitFor(() => expect(window.location.hash).toBe('#runs/run1/login?tab=attachments'));
    const list = await screen.findByRole('list', { name: 'Attachments of the run' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
  });

  it('opens the tab from the address', async () => {
    window.location.hash = '#runs/run1/login?tab=attachments';
    const api = fakeApi({ group: vi.fn(async () => groupView()) });
    render(<App api={api} openStream={openFake} />);
    act(() =>
      FakeEventSource.last!.send({
        event: 'snapshot',
        seq: 1,
        runs: [runView({ attachments: [attachment()] })],
      }),
    );
    const tab = await screen.findByRole('tab', { name: 'Attachments · 1' });
    expect(tab.getAttribute('aria-selected')).toBe('true');
  });
});

describe('attachments tab', () => {
  const mount = (list: AttachmentView[]) => {
    const api = fakeApi();
    render(<AttachmentsTab api={api} runId="run1" attachments={list} />);
    return api;
  };

  it('previews a picture lazily and links the full size in a new tab', () => {
    mount([attachment()]);
    const image = screen.getByRole<HTMLImageElement>('img', { name: 'Preview of shot.png' });
    expect(image.getAttribute('src')).toBe('/api/runs/run1/attachments/a1?inline=1');
    expect(image.getAttribute('loading')).toBe('lazy');
    const link = image.closest('a')!;
    expect(link.getAttribute('target')).toBe('_blank');
    expect(screen.getByRole('link', { name: 'Download shot.png' }).getAttribute('href')).toBe(
      '/api/runs/run1/attachments/a1',
    );
    expect(screen.getByText('2 KB · image/png')).toBeTruthy();
  });

  it('gives an SVG and other files a download link only', () => {
    mount([
      attachment({ id: 'a2', fileName: 'logo.svg', mediaType: 'image/svg+xml' }),
      attachment({ id: 'a3', fileName: 'spec.pdf', mediaType: 'application/pdf' }),
    ]);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByRole('link', { name: 'Download logo.svg' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Download spec.pdf' })).toBeTruthy();
  });

  it('shows the text of a log file', async () => {
    const fetched = vi.fn(async () => new Response('line one\nline two'));
    vi.stubGlobal('fetch', fetched);
    mount([attachment({ id: 'a4', fileName: 'run.log', mediaType: 'text/plain', size: 20 })]);
    const text = await screen.findByText(/line one/);
    expect(text.tagName).toBe('PRE');
    expect(fetched).toHaveBeenCalledWith('/api/runs/run1/attachments/a4?inline=1', {
      credentials: 'same-origin',
    });
    vi.unstubAllGlobals();
  });

  it('does not load a text file over the limit', () => {
    const fetched = vi.fn();
    vi.stubGlobal('fetch', fetched);
    mount([
      attachment({
        id: 'a5',
        fileName: 'huge.log',
        mediaType: 'text/plain',
        size: 5 * 1024 * 1024,
      }),
    ]);
    expect(fetched).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
