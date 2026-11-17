import type { Dictionary } from '../types.ts';

/** Тексты окна «Рой»: вкладки и подсказки пустых вкладок. */
export const swarmEs: Dictionary['swarm'] = {
  title: 'Enjambre',
  tabs: {
    label: 'Pestañas del enjambre',
    providers: 'Proveedores',
    roles: 'Roles',
    chains: 'Cadenas',
    specialists: 'Especialistas',
    pipelines: 'Pipeline',
  },
  palette: 'Enjambre → {{tab}}',
  hints: {
    needProvider: 'Primero crea un proveedor en la pestaña «Proveedores».',
    toProviders: 'A proveedores',
    toRoles: 'Configurar roles',
    rolesHint:
      'Los roles nombran tipos de trabajo (think, code…). El modelo de un rol se fija en cada proveedor.',
    chainsAbout:
      'Una cadena lista proveedores y modelos en orden de intentos. El especialista elige una cadena, el pipeline elige especialistas.',
  },
};
