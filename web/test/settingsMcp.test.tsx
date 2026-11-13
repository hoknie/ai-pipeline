// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/app/App.tsx';
import { agentTabOf } from '../src/shared/lib/nav/settingsGroups.ts';
import { formatRoute, parseRoute } from '../src/shared/lib/nav/route.ts';
import type { EditorMcpServer } from '../src/shared/api/types.ts';

import { configView, fakeApi, openFake, queueOf } from './fixtures.ts';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function server(overrides: Partial<EditorMcpServer> = {}): EditorMcpServer {
  return {
    name: 'graph',
    command: '/bin/graph',
    args: [],
    envNames: ['TOKEN'],
    allSpecialists: true,
    level: 'global',
    file: '/xdg/aip/settings.yaml',
    specialists: ['coder'],
    shared: { command: '/bin/graph', args: [], envNames: ['TOKEN'], allSpecialists: true },
    ...overrides,
  };
}

function show(hash: string, servers: EditorMcpServer[] = [], overrides = {}) {
  window.location.hash = hash;
  const api = fakeApi({
    queue: vi.fn(async () => queueOf()),
    config: vi.fn(async () => configView({ mcpServers: servers })),
    ...overrides,
  });
  render(<App api={api} openStream={openFake} />);
  return api;
}

const selected = (name: string) =>
  screen.getByRole('tab', { name }).getAttribute('aria-selected') === 'true';

describe('addresses of the tabs of the group Agents', () => {
  it('reads the third part of the address and falls back to the first tab', () => {
    expect(agentTabOf('mcp')).toBe('mcp');
    expect(agentTabOf('nope')).toBe('general');
    expect(agentTabOf(null)).toBe('general');
    expect(parseRoute('#settings/project/agents/mcp')).toMatchObject({
      run: 'agents',
      group: 'project',
      step: 'mcp',
    });
    expect(formatRoute(parseRoute('#settings/project/agents/mcp'))).toBe(
      '#settings/project/agents/mcp',
    );
    expect(formatRoute(parseRoute('#settings/global/agents/nope'))).toBe('#settings/global/agents');
    expect(formatRoute(parseRoute('#settings/defaults'))).toBe('#settings/global/agents');
    expect(formatRoute(parseRoute('#settings/claude'))).toBe('#settings/global/agents');
  });

  it('opens the tab MCP servers after a reload of the page', async () => {
    show('#settings/global/agents/mcp', [server()]);
    await screen.findByRole('list', { name: 'MCP servers' });
    expect(selected('MCP servers')).toBe(true);
    expect(selected('Main')).toBe(false);
  });

  it('opens Main for an unknown tab without an error', async () => {
    show('#settings/project/agents/nope');
    await screen.findByTestId('setting-defaults.runtime');
    expect(selected('Main')).toBe(true);
    await waitFor(() => expect(window.location.hash).toBe('#settings/project/agents'));
  });

  it('changes the address when a tab is chosen', async () => {
    show('#settings/global/agents');
    await screen.findByTestId('setting-defaults.runtime');
    fireEvent.click(screen.getByRole('tab', { name: 'MCP servers' }));
    await waitFor(() => expect(window.location.hash).toBe('#settings/global/agents/mcp'));
  });
});

describe('the tab MCP servers', () => {
  it('explains an empty catalog and offers a new server', async () => {
    show('#settings/global/agents/mcp');
    expect(await screen.findByText(/go to the specialists of every runtime/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New server' })).toBeTruthy();
  });

  it('lists a server with its command, source and number of specialists', async () => {
    show('#settings/global/agents/mcp', [server()]);
    const list = await screen.findByRole('list', { name: 'MCP servers' });
    const row = within(list);
    expect(row.getByText('graph')).toBeTruthy();
    expect(row.getByText('/bin/graph')).toBeTruthy();
    expect(row.getByText('Shared')).toBeTruthy();
    expect(row.getByText('All specialists')).toBeTruthy();
    expect(row.getByText('1 specialist')).toBeTruthy();
  });

  it('writes a new server to the level of the tab', async () => {
    const api = show('#settings/global/agents/mcp');
    fireEvent.click(await screen.findByRole('button', { name: 'New server' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'graph' } });
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: '/bin/graph' } });
    fireEvent.change(screen.getByLabelText('Arguments (one per line)'), {
      target: { value: '--a\n\n--b' },
    });
    fireEvent.click(screen.getByRole('switch', { name: 'All specialists' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.writeMcpServer).toHaveBeenCalledWith(
        'graph',
        { command: '/bin/graph', args: ['--a', '--b'], env: {}, allSpecialists: true },
        'g1',
        'global',
      ),
    );
  });

  it('sends a saved variable without a value and a new one with it', async () => {
    const api = show('#settings/global/agents/mcp', [server()]);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit graph' }));
    expect((screen.getByLabelText('Name') as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: '/opt/graph' } });
    fireEvent.change(screen.getByLabelText('Variable name of graph'), { target: { value: 'KEY' } });
    fireEvent.change(screen.getByLabelText('Variable value of graph'), {
      target: { value: 'secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.writeMcpServer).toHaveBeenCalledWith(
        'graph',
        {
          command: '/opt/graph',
          args: [],
          env: { TOKEN: null, KEY: 'secret' },
          allSpecialists: true,
        },
        'g1',
        'global',
      ),
    );
  });

  it('shows the error of the command at the field and keeps the form', async () => {
    show('#settings/global/agents/mcp', [], {
      writeMcpServer: vi.fn(async () => ({
        ok: false as const,
        reason: 'invalid' as const,
        errors: [
          {
            path: 'swarm.mcp_servers.graph.command',
            message: 'must be a command name or an absolute path',
          },
        ],
      })),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'New server' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'graph' } });
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'bin/graph' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('must be a command name or an absolute path');
    expect((screen.getByLabelText('Command') as HTMLInputElement).value).toBe('bin/graph');
  });

  it('asks before deleting and deletes with the revision of the level', async () => {
    const api = show('#settings/global/agents/mcp', [server()]);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit graph' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete', hidden: false }));
    await waitFor(() => expect(api.deleteMcpServer).toHaveBeenCalledWith('graph', 'g1', 'global'));
  });

  it('shows the error of a failed delete inside the dialog', async () => {
    const api = show('#settings/global/agents/mcp', [server()], {
      deleteMcpServer: vi.fn(async () => ({
        ok: false as const,
        reason: 'conflict' as const,
        message: 'The file changed on disk',
      })),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Edit graph' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete', hidden: false }));
    await waitFor(() => expect(api.deleteMcpServer).toHaveBeenCalled());
    const message = await screen.findByText('The file changed on disk');
    expect(message.closest('[role="dialog"]')).not.toBeNull();
  });

  it('shows the form in a modal dialog', async () => {
    show('#settings/global/agents/mcp');
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'New server' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Command')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('asks before closing the dialog with unsaved changes', async () => {
    show('#settings/global/agents/mcp');
    fireEvent.click(await screen.findByRole('button', { name: 'New server' }));
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: '/bin/x' } });
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await screen.findByText('Leave without saving?');
    expect(window.location.hash).toBe('#settings/global/agents/mcp');
  });
});

describe('the tab MCP servers of the project', () => {
  it('shows a shared server read only and overrides it in the project file', async () => {
    const api = show('#settings/project/agents/mcp', [server()]);
    expect(await screen.findByRole('button', { name: 'Override in project graph' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit graph' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Override in project graph' }));
    expect((screen.getByLabelText('Command') as HTMLInputElement).value).toBe('/bin/graph');
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: '/opt/graph' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.writeMcpServer).toHaveBeenCalledWith(
        'graph',
        { command: '/opt/graph', args: [], env: {}, allSpecialists: true },
        null,
        'project',
      ),
    );
  });

  it('marks a project server over a shared one and restores the shared one', async () => {
    const servers = [server({ command: '/opt/graph', level: 'project_over_global' })];
    const api = show('#settings/project/agents/mcp', servers, {
      config: vi.fn(async () =>
        configView({
          mcpServers: servers,
          settingsFiles: {
            global: { file: '/xdg/aip/settings.yaml', revision: 'g1' },
            project: { file: '/repo/aip/settings.yaml', revision: 'p1' },
          },
        }),
      ),
    });
    expect(await screen.findByText('Project over shared')).toBeTruthy();
    expect(screen.getByText('/opt/graph')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Restore shared graph' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Restore shared', hidden: false }));
    await waitFor(() => expect(api.deleteMcpServer).toHaveBeenCalledWith('graph', 'p1', 'project'));
  });

  it('does not list a server that only the project defines on the shared tab', async () => {
    show('#settings/global/agents/mcp', [server({ level: 'project', shared: null })]);
    await screen.findByText(/go to the specialists of every runtime/);
    expect(screen.queryByText('graph')).toBeNull();
  });
});
