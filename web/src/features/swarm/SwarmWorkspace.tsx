import { useEffect } from 'react';

import { GlobalBody } from './global/GlobalBody.tsx';
import { rememberSwarm } from './memory.ts';
import { ProjectBody } from './project/ProjectBody.tsx';
import { SwarmTabs } from './SwarmTabs.tsx';
import type { SwarmWorkspaceProps } from './types/props.ts';

/**
 * The window «Swarm»: the tabs Providers, Roles, Chains, Specialists and Pipeline of one scope,
 * the selected project or the shared level. The top bar and the settings both host it.
 */
export function SwarmWorkspace(props: SwarmWorkspaceProps) {
  const { scope, place, hrefOf, onNavigate } = props;
  useEffect(() => rememberSwarm(scope, place), [scope, place]);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="px-4 pt-3">
        <SwarmTabs
          scope={scope}
          place={place}
          dirty={props.dirty}
          hrefOf={hrefOf}
          onNavigate={onNavigate}
        />
      </div>
      {scope === 'global' ? <GlobalBody {...props} /> : <ProjectBody {...props} />}
    </div>
  );
}
