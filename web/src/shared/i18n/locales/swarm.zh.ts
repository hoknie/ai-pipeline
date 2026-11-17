import type { Dictionary } from '../types.ts';

/** Тексты окна «Рой»: вкладки и подсказки пустых вкладок. */
export const swarmZh: Dictionary['swarm'] = {
  title: '集群',
  tabs: {
    label: '集群标签页',
    providers: '提供商',
    roles: '角色',
    chains: '链',
    specialists: '专家',
    pipelines: 'Pipeline',
  },
  palette: '集群 → {{tab}}',
  hints: {
    needProvider: '请先在“提供商”标签页创建提供商。',
    toProviders: '前往提供商',
    toRoles: '设置角色',
    rolesHint: '角色是工作类型的名称（think、code…）。角色的模型在每个提供商上设置。',
    chainsAbout: '链按尝试顺序列出提供商和模型。专家选择链，pipeline 选择专家。',
  },
};
