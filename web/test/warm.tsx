import { cleanup, fireEvent, render, screen, waitFor } from './render.tsx';
import { vi } from 'vitest';
import { App } from '../src/App.tsx';
import { fakeApi, openFake } from './fixtures.ts';

/**
 * Draws the panel once before the tests of a file, so that the cold start of the renderer (the
 * first draw of the shell, of the queue page and of the form of a new task costs hundreds of
 * milliseconds) is not paid by the first test that happens to need it. Pages that draw the
 * workflow graph are not visited: a test file may replace the graph.
 */
export async function warmUp(): Promise<void> {
  const noise = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  window.location.hash = '#queue';
  render(<App api={fakeApi()} openStream={openFake} />);
  const controls = await screen.findByLabelText('queue controls');
  await waitFor(() => {
    const button = controls.querySelector<HTMLButtonElement>('button');
    if (!button) throw new Error('no button');
  });
  const open = [...controls.querySelectorAll('button')].find((b) => b.textContent === 'New task');
  if (open) fireEvent.click(open);
  await screen.findByLabelText('Task text');
  window.location.hash = '#specialists';
  await screen.findByText('CODER').catch(() => undefined);
  cleanup();
  window.location.hash = '';
  window.localStorage.clear();
  noise.mockRestore();
}
