import { describe, expect, it } from 'vitest';

import {
  AppError,
  appError,
  errorMessage,
  isAppError,
  isRejected,
  rejected,
} from '../../src/platform/errors/index.ts';
import { GitError } from '../../src/platform/git/index.ts';
import { DaemonUnavailable, IpcError } from '../../src/presentation/ipc/client/index.ts';
import { ConfigLoadError } from '../../src/feature/swarm-config/types/index.ts';
import { ConfigEditError } from '../../src/feature/swarm-edit/types/index.ts';
import { AlreadyRunning } from '../../src/app/daemon.ts';

describe('AppError', () => {
  it('keeps the kind, the code and the message', () => {
    const error = new AppError('conflict', 'busy', { code: 'x.busy', responseCode: 'busy' });
    expect(error).toBeInstanceOf(Error);
    expect([error.kind, error.code, error.responseCode, error.message]).toEqual([
      'conflict',
      'x.busy',
      'busy',
      'busy',
    ]);
  });

  it('has no responseCode unless given', () => {
    expect(appError('invalid', 'x.y', 'bad').responseCode).toBeUndefined();
  });

  it('keeps the cause', () => {
    const cause = new Error('low');
    expect(new AppError('internal', 'm', { code: 'x', cause }).cause).toBe(cause);
  });

  it('tells app errors from other values', () => {
    expect(isAppError(rejected('no'))).toBe(true);
    expect(isAppError(new Error('no'))).toBe(false);
    expect(isAppError('no')).toBe(false);
  });

  it('recognises a rejection only by its own code', () => {
    expect(isRejected(rejected('no'))).toBe(true);
    expect(rejected('no').kind).toBe('rejected');
    expect(isRejected(appError('rejected', 'other', 'no'))).toBe(false);
    expect(isRejected(new IpcError('no'))).toBe(false);
  });
});

describe('errorMessage', () => {
  it('reads the message of errors and of error-like values', () => {
    expect(errorMessage(rejected('no'))).toBe('no');
    expect(errorMessage(new Error('plain'))).toBe('plain');
    expect(errorMessage({ message: 'like' })).toBe('like');
  });

  it('turns anything else into text', () => {
    expect(errorMessage('text')).toBe('text');
    expect(errorMessage(null)).toBe('null');
    expect(errorMessage(undefined)).toBe('undefined');
  });
});

describe('error classes of the owners', () => {
  it('are app errors of the agreed kind', () => {
    expect(new IpcError('x').kind).toBe('rejected');
    expect(new DaemonUnavailable('/s', new Error('refused')).kind).toBe('unavailable');
    expect(new DaemonUnavailable('/s', new Error('refused')).message).toBe(
      'aip daemon is not reachable at /s: refused',
    );
    expect(new AlreadyRunning(5)).toBeInstanceOf(AppError);
    expect(new AlreadyRunning(5).message).toBe('already running (pid 5)');
    expect(new ConfigEditError('bad').message).toBe('bad');
    expect(new ConfigEditError('bad')).toBeInstanceOf(AppError);
    const git = new GitError(['status'], 128, 'boom\n');
    expect(git).toBeInstanceOf(AppError);
    expect([git.exitCode, git.message]).toEqual([128, 'git status failed (128): boom']);
    expect(
      new ConfigLoadError({ kind: 'invalid', errors: [{ path: 'a', message: 'b' }] } as never),
    ).toBeInstanceOf(AppError);
  });
});
