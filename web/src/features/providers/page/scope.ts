import { createContext, useContext } from 'react';

import type { ProvidersScope } from './sources.ts';

/** The scope of the providers page below: the files of its writes and the registry it reads. */
export const ScopeContext = createContext<ProvidersScope>('project');

export const useProvidersScope = (): ProvidersScope => useContext(ScopeContext);

/** The `level` parameter of the registry and of the models for a scope. */
export const levelOf = (scope: ProvidersScope): 'global' | undefined =>
  scope === 'global' ? 'global' : undefined;
