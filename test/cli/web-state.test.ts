import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  panelStatePath,
  previousPanelToken,
  readPanelState,
  removePanelState,
  writePanelState,
  type PanelState,
} from '../../src/presentation/web/panel/state.ts';

const directory = (): string => mkdtempSync(join(tmpdir(), 'aip-web-state-'));

function state(pid: number): PanelState {
  return {
    pid,
    host: '127.0.0.1',
    port: 7341,
    auth: 'token',
    token: 'abcdefghijklmnop1234',
    url: 'http://127.0.0.1:7341/?token=abcdefghijklmnop1234',
  };
}

const children: { kill(): boolean }[] = [];
afterEach(() => {
  for (const child of children.splice(0)) child.kill();
});

describe('panel state file', () => {
  it('is written readable by the user only and read back', () => {
    const dir = directory();
    writePanelState(dir, state(process.pid));
    expect(statSync(panelStatePath(dir)).mode & 0o777).toBe(0o600);
    expect(readPanelState(dir)).toEqual(state(process.pid));
  });

  it('is absent, broken or of a dead process: no panel', () => {
    const dir = directory();
    expect(readPanelState(dir)).toBeNull();
    writeFileSync(panelStatePath(dir), '{not json');
    expect(readPanelState(dir)).toBeNull();
    // a pid that does not exist
    writePanelState(dir, state(2 ** 22 + 12345));
    expect(readPanelState(dir)).toBeNull();
    // the token of the dead panel is still known
    expect(previousPanelToken(dir)).toBe('abcdefghijklmnop1234');
  });

  it('is removed only by its owner', () => {
    const dir = directory();
    const other = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
      stdio: 'ignore',
    });
    children.push(other);
    writePanelState(dir, state(other.pid ?? 0));
    removePanelState(dir, process.pid);
    expect(existsSync(panelStatePath(dir))).toBe(true);
    removePanelState(dir, other.pid ?? 0);
    expect(existsSync(panelStatePath(dir))).toBe(false);
    removePanelState(dir, process.pid);
  });
});
