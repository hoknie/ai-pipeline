import { useEffect, useMemo } from 'react';

import { useProviderEditor } from '../providers/index.ts';
import { GlobalBody } from './global/GlobalBody.tsx';
import { rememberSwarm } from './memory.ts';
import { ProjectBody } from './project/ProjectBody.tsx';
import { ProviderUsageBlock } from './ProviderUsage.tsx';
import { SwarmTabs } from './SwarmTabs.tsx';
import type { SwarmWorkspaceProps } from './types/props.ts';
import { levelEntries, providerUsage } from './types/usage.ts';

/**
 * The window «Swarm»: the tabs Providers, Roles, Chains, Specialists and Pipeline of one scope,
 * the selected project or the shared level. The top bar and the settings both host it.
 */
export function SwarmWorkspace(props: SwarmWorkspaceProps) {
  const { api, scope, place, repository, hrefOf, onNavigate } = props;
  const { editor } = useProviderEditor(api, repository);
  useEffect(() => rememberSwarm(scope, place), [scope, place]);
  const entries = useMemo(() => (editor ? levelEntries(editor, scope) : null), [editor, scope]);
  const usage = entries
    ? (slug: string) => (
        <ProviderUsageBlock
          usage={providerUsage(entries, slug)}
          hrefOf={hrefOf}
          onNavigate={onNavigate}
        />
      )
    : undefined;
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
      {scope === 'global' ? (
        <GlobalBody {...props} usage={usage} />
      ) : (
        <ProjectBody {...props} usage={usage} />
      )}
    </div>
  );
}
