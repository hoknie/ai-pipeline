import { describe, expect, it } from 'vitest';

import { daemonStatus, formatDaemonStatus } from '../../src/presentation/cli/commands/daemon.ts';
import type { DaemonCheck } from '../../src/presentation/ipc/contract/index.ts';

const build = { version: '1.2.3', fingerprint: 'abc', builtAt: 5 };

describe('formatDaemonStatus', () => {
  it('describes a running daemon', () => {
    const status = daemonStatus({ pong: true, pid: 42, build, busy: true }, null, '/tmp/s.sock');
    expect(formatDaemonStatus(status)).toBe(
      [
        'aip daemon: running (pid 42)',
        'version: 1.2.3',
        'build: abc',
        'busy: yes',
        'socket: /tmp/s.sock',
      ].join('\n'),
    );
  });

  it('says that no daemon runs', () => {
    const status = daemonStatus(null, null, '/tmp/s.sock');
    expect(status).toMatchObject({ running: false, pid: null, mismatch: null });
    expect(formatDaemonStatus(status)).toBe('aip daemon: not running');
  });

  it('adds the build mismatch', () => {
    const check: DaemonCheck = {
      started: false,
      restarted: false,
      mismatch: { outdated: 'daemon', pid: 42, daemon: build, client: build, busy: false },
    };
    const status = daemonStatus({ pong: true, pid: 42, build, busy: false }, check, 's');
    expect(status.mismatch).toBe('daemon');
    expect(formatDaemonStatus(status, 'older build')).toContain('warning: older build');
  });
});
