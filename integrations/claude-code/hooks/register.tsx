import type { Register } from 'claude-code';

import { background, createActions, createFeed, readPaneModel, runAip, type Feed } from './aip.ts';
import {
  aipArgv,
  applyArgv,
  describeApply,
  describeRunQueued,
  parseApplyCommand,
  parseApplyResult,
  parseRunCommand,
  parseRunQueued,
  parseRunView,
  parseRuns,
  parseStatusCommand,
  parseWebCommand,
  runMarkdown,
  statusMarkdown,
  COMPACT_COLUMNS,
} from './feed.ts';
import { registerTranscript } from './transcript.tsx';
import { renderPane } from './view.tsx';
import { createWebServer, type WebServer } from './web.ts';

const PANE = 'aip';
const NOT_RUNNING = 'aip web is not running.';
const DAEMON_OWNED =
  'The panel belongs to the aip daemon and stops with it (or set web.autostart: false).';

const COMMAND_FAILED = { text: 'the command failed (details in claude --debug)' };

export const register: Register = (on, options) => {
  const argv = aipArgv(options.aipCommand);
  let feed: Feed | null = null;
  let web: WebServer | null = null;

  on('session.start', async ($, e, next) => {
    const started = await next(e);
    feed?.stop();
    feed = createFeed($, argv);
    feed.start();
    return started;
  });

  on('session.end', async ($, e, next) => {
    feed?.stop();
    feed = null;
    await web?.stop();
    $.ui.status(undefined);
    return next(e);
  });

  on('command.run', { command: 'aip:run' }, async ($, e) => {
    const parsed = parseRunCommand(e.args);
    if (!parsed.ok) return { text: parsed.error };
    const repository = await $.session.cwd();
    const { workflow, task } = parsed.value;
    const outcome = await runAip($, argv, [
      'run',
      'start',
      workflow,
      '--task',
      task,
      '--repo',
      repository,
      '--json',
    ]);
    if (!outcome.ok) return { text: outcome.error };
    const queued = parseRunQueued(outcome.stdout);
    return { text: queued ? describeRunQueued(queued) : outcome.stdout.trim() };
  }).catch(($, e, next) => (next.called ? next(e) : COMMAND_FAILED));

  on('command.run', { command: 'aip:status' }, async ($, e) => {
    const parsed = parseStatusCommand(e.args);
    if (!parsed.ok) return { text: parsed.error };
    const outcome = await runAip($, argv, [
      'run',
      ...(parsed.value ? ['show', parsed.value] : ['list']),
      '--json',
    ]);
    if (!outcome.ok) return { text: outcome.error };
    if (parsed.value) {
      const one = parseRunView(outcome.stdout);
      return { text: one ? runMarkdown(one) : outcome.stdout.trimEnd() };
    }
    const list = parseRuns(outcome.stdout);
    return { text: list ? statusMarkdown(list) : outcome.stdout.trimEnd() };
  }).catch(($, e, next) => (next.called ? next(e) : COMMAND_FAILED));

  on('command.run', { command: 'aip:apply' }, async ($, e) => {
    const parsed = parseApplyCommand(e.args);
    if (!parsed.ok) return { text: parsed.error };
    const outcome = await runAip($, argv, applyArgv(parsed.value, true));
    const result = parseApplyResult(outcome.stdout);
    if (result) return { text: describeApply(result).text };
    return { text: outcome.ok ? outcome.stdout.trimEnd() : outcome.error };
  }).catch(($, e, next) => (next.called ? next(e) : COMMAND_FAILED));

  on('command.run', { command: 'aip:panel' }, async ($, e) => {
    const action = e.args.trim();
    if (action === 'close') {
      await $.ui.close({ id: PANE });
      return { text: 'aip pane closed.' };
    }
    if (action !== '') return { text: 'Usage: /aip:panel [close]' };
    const opened = await $.ui.open({ id: PANE, title: 'aip' });
    return { text: opened.isPlaced ? 'aip pane opened.' : `aip pane not shown: ${opened.reason}` };
  }).catch(($, e, next) => (next.called ? next(e) : COMMAND_FAILED));

  on('command.run', { command: 'aip:web' }, async ($, e) => {
    const parsed = parseWebCommand(e.args);
    if (!parsed.ok) return { text: parsed.error };
    web ??= createWebServer($, argv);
    const { action, port } = parsed.value;
    if (action === 'stop') {
      const stopped = await web.stop();
      if (stopped === 'daemon') return { text: DAEMON_OWNED };
      return { text: stopped === 'stopped' ? 'aip web stopped.' : NOT_RUNNING };
    }
    if (action === 'status') {
      const url = await web.status();
      return { text: url ? `aip web: ${url}` : NOT_RUNNING };
    }
    const result = await (action === 'restart' ? web.restart(port) : web.start(port));
    return { text: result.ok ? `aip web: ${result.url}` : result.error };
  }).catch(($, e, next) => (next.called ? next(e) : COMMAND_FAILED));

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e);
    const model = await readPaneModel($, {
      compact: e.viewport !== undefined && e.viewport.columns < COMPACT_COLUMNS,
    });
    const actions = createActions($, argv);
    return renderPane(
      {
        Box: elements.Box,
        Text: elements.Text,
        Button: elements.Button,
        Markdown: elements.Markdown,
        ...('Input' in elements ? { Input: elements.Input } : {}),
      },
      model,
      {
        select: (runId) => background(actions.select(runId)),
        draft: (key, text) => background(actions.draft(key, text)),
        answer: (runId, group, text, question) =>
          background(actions.answer(runId, group, text, question)),
        retry: (runId, group) => background(actions.retry(runId, group)),
        cancel: (runId, group) => background(actions.cancel(runId, group)),
        apply: (runId, group) => background(actions.apply(runId, group)),
      },
    );
  });

  registerTranscript(on);
};
