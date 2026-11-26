import type { QueueFormProps } from '../../QueueForm.tsx';
import type { FormState } from '../TaskFields.tsx';
import type { QueueDraft } from '../../draft.ts';
import { cn } from '../../../../shared/lib/browser/cn.ts';
import { TaskFields } from '../TaskFields.tsx';
import { withCurrent } from '../LinkFields.tsx';
import { SideFields } from './SideFields.tsx';

export function FormColumns(
  props: QueueFormProps & {
    state: FormState;
    branchValidation: 'valid' | 'pending' | 'invalid';
    ids: string[];
    effective: QueueDraft;
    providerError: string | undefined;
  },
) {
  const {
    state,
    repositoryField,
    extras,
    fill = false,
    api,
    pipelines,
    repository,
    linkChoices = () => [],
    returnedRun = null,
    projectsPanel,
    autoDeliverDefault = null,
    deliveryModeDefault = null,
    branchValidation,
    ids,
    effective,
    providerRepositories,
    providerError,
  } = props;
  return (
    <div
      className={cn(
        'grid gap-4 @3xl:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)]',
        fill && 'flex-1',
      )}
    >
      <TaskFields
        state={state}
        repositoryField={repositoryField}
        extras={extras}
        fill={fill}
        api={api}
      />
      <SideFields
        {...{ state, pipelines, repository, api, linkChoices, returnedRun, projectsPanel }}
        {...{ autoDeliverDefault, deliveryModeDefault, providerError }}
        branchValidation={branchValidation}
        options={withCurrent(ids, effective.pipeline)}
        repositories={providerRepositories ?? (repository ? [repository] : [])}
      />
    </div>
  );
}
