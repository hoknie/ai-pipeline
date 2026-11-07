import {
  MESSAGE_INSTRUCTIONS,
  RESOLVE_INSTRUCTIONS,
  specialistName,
  splitInstructionText,
  type StagePerformer,
} from '../../runs/types/index.ts';
import type { ResolvedConfig } from '../../swarm-config/types/index.ts';

import type { EditorSetting } from './editor.ts';
import type { SystemStageSetting, SystemStageView } from './views.ts';

/** The settings of the keys with the level each comes from. */
function pick(settings: ReadonlyMap<string, EditorSetting>, keys: string[]): SystemStageSetting[] {
  return keys.flatMap((key) => {
    const setting = settings.get(key);
    if (!setting) return [];
    const level =
      setting.written.project !== undefined
        ? 'project'
        : setting.written.global !== undefined
          ? 'global'
          : 'default';
    return [{ path: key, value: setting.value, level }];
  });
}

/** The built-in stages of the pipeline with their tasks and the settings that apply. */
export function systemStagesOf(
  config: ResolvedConfig,
  settings: ReadonlyMap<string, EditorSetting>,
): SystemStageView[] {
  const { delivery } = config;
  const named = (slug: string | null): StagePerformer | null =>
    slug === null ? null : { type: 'specialist', slug, name: specialistName(config, slug) };
  return [
    {
      kind: 'split',
      name: 'Split',
      performer: null,
      task: splitInstructionText('{max_groups}'),
      settings: [],
    },
    {
      kind: 'message',
      name: 'Commit message',
      performer: named(delivery.messageSpecialist),
      task: [
        ...MESSAGE_INSTRUCTIONS('{run}'),
        'Task:\n{task}',
        'Groups:\n{groups}',
        'Changed files:\n{files}',
      ].join('\n\n'),
      settings: pick(settings, [
        'delivery.message_specialist',
        'delivery.message_prompt',
        'delivery.commit_message',
      ]),
    },
    {
      kind: 'delivery',
      name: 'Delivery',
      performer: { type: 'system' },
      task: null,
      settings: pick(settings, ['delivery.mode', 'delivery.auto', 'delivery.keep']),
    },
    {
      kind: 'resolve',
      name: 'Resolve conflicts',
      performer: named(delivery.resolver),
      task: [
        ...RESOLVE_INSTRUCTIONS('{run}'),
        'Conflicting files:\n{files}',
        'Task of the run:\n{task}',
        'Groups:\n{groups}',
      ].join('\n\n'),
      settings: pick(settings, [
        'delivery.resolver',
        'delivery.resolver_rounds',
        'delivery.resolver_prompt',
      ]),
    },
  ];
}
