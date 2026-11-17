/** The texts of the «Swarm» window: its tabs and the hints of empty tabs. */
export const swarmEn = {
  title: 'Swarm',
  tabs: {
    label: 'Swarm tabs',
    providers: 'Providers',
    roles: 'Roles',
    chains: 'Chains',
    specialists: 'Specialists',
    pipelines: 'Pipeline',
  },
  palette: 'Swarm → {{tab}}',
  hints: {
    needProvider: 'Create a provider on the «Providers» tab first.',
    toProviders: 'To providers',
    toRoles: 'Set up roles',
    rolesHint:
      'Roles name kinds of work (think, code…). The model of a role is set on each provider.',
    chainsAbout:
      'A chain lists providers and models in the order of attempts. A specialist picks a chain, a pipeline picks specialists.',
  },
};
