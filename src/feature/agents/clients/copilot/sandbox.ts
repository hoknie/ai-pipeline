import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { findExecutable } from '../../../../platform/process/index.ts';
import type { GeneratedFile } from '../../types/index.ts';

export interface SandboxSpec {
  platform: NodeJS.Platform;
  /** The environment of the daemon: `PATH` and `AIP_COPILOT_SANDBOX_BIN`. */
  environment: NodeJS.ProcessEnv;
  command: string;
  args: string[];
  worktree: string;
  /** The private folder of this conversation: the only place besides the worktree that is written. */
  privateDirectory: string;
  /** The folder of all conversations of the group; the other conversations in it are hidden. */
  conversationsRoot: string;
  /** Edit and full may write the worktree; read may not. */
  writeWorktree: boolean;
  /** Where the profile of the sandbox is written. */
  profilePath: string;
  /** Paths inside the writable folders that stay read-only: the gate, its policy and the hooks. */
  readOnly?: string[];
}

export interface Sandboxed {
  command: string;
  args: string[];
  files: GeneratedFile[];
}

/** The path with its links resolved, also when the last parts do not exist yet. */
export function canonicalPath(path: string): string {
  const absolute = resolve(path);
  let existing = absolute;
  while (!existsSync(existing) && dirname(existing) !== existing) existing = dirname(existing);
  const rest = relative(existing, absolute);
  return rest === '' ? realpathSync(existing) : join(realpathSync(existing), rest);
}

/** The git directories a worktree writes to (its own gitdir and the objects of the common one). */
export function gitWriteRoots(worktree: string): string[] {
  try {
    const pointer = readFileSync(join(worktree, '.git'), 'utf8').match(/^gitdir:\s*(.+)$/m)?.[1];
    if (!pointer) return [];
    const gitdir = isAbsolute(pointer.trim()) ? pointer.trim() : resolve(worktree, pointer.trim());
    const common = (() => {
      try {
        return resolve(gitdir, readFileSync(join(gitdir, 'commondir'), 'utf8').trim());
      } catch {
        return null;
      }
    })();
    return [gitdir, ...(common ? [join(common, 'objects')] : [])].filter((path) =>
      existsSync(path),
    );
  } catch {
    return [];
  }
}

const quoted = (path: string): string =>
  `"${path.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;

/** The Seatbelt profile: reads as usual except the other conversations; writes only where allowed. */
export function seatbeltProfile(spec: SandboxSpec, writable: string[]): string {
  return [
    '(version 1)',
    '(allow default)',
    '(deny file-write*)',
    `(allow file-write* ${writable.map((path) => `(subpath ${quoted(path)})`).join(' ')} (literal "/dev/null") (literal "/dev/tty") (regex #"^/dev/ttys[0-9]+$"))`,
    ...(spec.readOnly ?? []).map(
      (path) => `(deny file-write* (subpath ${quoted(canonicalPath(path))}))`,
    ),
    `(deny file-read* (subpath ${quoted(canonicalPath(spec.conversationsRoot))}))`,
    `(allow file-read* (subpath ${quoted(canonicalPath(spec.privateDirectory))}))`,
    '',
  ].join('\n');
}

/** Where the sandbox program is; null when there is none, and then the CLI does not start. */
export function sandboxProgram(spec: Pick<SandboxSpec, 'platform' | 'environment'>): string | null {
  const override = spec.environment.AIP_COPILOT_SANDBOX_BIN;
  if (override) return override;
  if (spec.platform === 'darwin')
    return existsSync('/usr/bin/sandbox-exec') ? '/usr/bin/sandbox-exec' : null;
  if (spec.platform === 'linux') return findExecutable('bwrap', spec.environment.PATH) ?? null;
  return null;
}

/**
 * Wraps the CLI and everything it starts in an OS sandbox: Seatbelt on macOS, bubblewrap on Linux.
 * Without a sandbox for the platform it throws: Copilot never runs without one.
 */
export function sandboxed(spec: SandboxSpec): Sandboxed {
  const program = sandboxProgram(spec);
  if (program === null) {
    throw new Error(
      `copilot: no OS sandbox on ${spec.platform} (sandbox-exec on macOS, bubblewrap on Linux); the CLI is not started without one`,
    );
  }
  const worktree = canonicalPath(spec.worktree);
  const writable = [
    canonicalPath(spec.privateDirectory),
    ...(spec.writeWorktree ? [worktree, ...gitWriteRoots(worktree).map(canonicalPath)] : []),
  ];
  if (spec.platform === 'darwin') {
    return {
      command: program,
      args: ['-f', spec.profilePath, spec.command, ...spec.args],
      files: [{ path: spec.profilePath, content: seatbeltProfile(spec, writable) }],
    };
  }
  return {
    command: program,
    args: [
      '--ro-bind',
      '/',
      '/',
      '--dev',
      '/dev',
      '--proc',
      '/proc',
      '--tmpfs',
      canonicalPath(spec.conversationsRoot),
      ...writable.flatMap((path) => ['--bind', path, path]),
      ...(spec.readOnly ?? []).flatMap((path) => [
        '--ro-bind',
        canonicalPath(path),
        canonicalPath(path),
      ]),
      '--unshare-pid',
      '--die-with-parent',
      '--',
      spec.command,
      ...spec.args,
    ],
    files: [],
  };
}
