import type { ExceptionEntry } from './reconcile.ts';

/**
 * Старые нарушения пределов, чистоты и окружения. Список только сокращается: записи не добавляют,
 * размер не увеличивают, а запись, которая больше не нужна, удаляют.
 */
export const exceptions: ExceptionEntry[] = [
  { rule: 'class-size', path: 'src/daemon/daemon.ts', name: 'Daemon', size: 15 },
  { rule: 'file-size', path: 'src/daemon/daemon.ts', size: 2725 },
  { rule: 'function-size', path: 'src/daemon/daemon.ts', name: '<anonymous>', size: 202 },
  { rule: 'function-size', path: 'src/daemon/daemon.ts', name: 'handle', size: 223 },
  { rule: 'function-size', path: 'src/daemon/daemon.ts', name: 'queueRequest', size: 209 },
  { rule: 'function-size', path: 'src/daemon/daemon.ts', name: 'systemStages', size: 82 },
  { rule: 'file-size', path: 'src/daemon/executor.ts', size: 817 },
  { rule: 'function-size', path: 'src/daemon/executor.ts', name: 'start', size: 141 },
  { rule: 'function-size', path: 'src/daemon/supervisor.ts', name: 'launchProcess', size: 135 },
  { rule: 'file-size', path: 'src/platform/git/delivery.ts', size: 375 },
  { rule: 'file-size', path: 'src/platform/git/workspace.ts', size: 449 },
  { rule: 'file-size', path: 'src/runtime/claude.ts', size: 383 },
  { rule: 'function-size', path: 'src/runtime/claude.ts', name: 'createClaudeRuntime', size: 183 },
  { rule: 'function-size', path: 'src/runtime/claude.ts', name: 'createParser', size: 93 },
  {
    rule: 'function-size',
    path: 'src/runtime/opencode.ts',
    name: 'createOpencodeRuntime',
    size: 135,
  },
  { rule: 'function-size', path: 'src/runtime/transcript.ts', name: 'claudeTranscript', size: 81 },
];
