import type { Dictionary } from '../types.ts';

/** Тексты окна «Рой»: вкладки и подсказки пустых вкладок. */
export const swarmRu: Dictionary['swarm'] = {
  title: 'Рой',
  tabs: {
    label: 'Вкладки роя',
    providers: 'Провайдеры',
    roles: 'Роли',
    chains: 'Цепочки',
    specialists: 'Специалисты',
    pipelines: 'Pipeline',
  },
  palette: 'Рой → {{tab}}',
  hints: {
    needProvider: 'Сначала создайте провайдера на вкладке «Провайдеры».',
    toProviders: 'К провайдерам',
    toRoles: 'Настроить роли',
    rolesHint: 'Роли — названия задач (think, code…). Модель роли задаётся у каждого провайдера.',
    chainsAbout:
      'Цепочка — провайдеры и модели в порядке попыток. Специалист выбирает цепочку, pipeline — специалистов.',
  },
};
