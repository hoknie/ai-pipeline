import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { DeliveryMode } from '../../../../../../src/feature/swarm-config/types/index.ts';
import type { Api } from '../../../../shared/api/api.ts';
import type { PipelinesView } from '../../../../shared/api/types.ts';
import { formatRoute } from '../../../../shared/lib/nav/route.ts';
import { LinksEditor, type LinkKind, type LinkTargetGroup } from '../../../runs/index.ts';
import { DeliveryFields } from '../DeliveryFields.tsx';
import { FormSection } from './FormSection.tsx';
import { TagsField } from '../LinkFields.tsx';
import { RunFields } from './RunFields.tsx';
import type { FormState } from '../TaskFields.tsx';

const SECTION_LEGEND = 'mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase';

/** The properties column: projects, run, links, tags, and delivery. */
export function SideFields(props: {
  state: FormState;
  pipelines: PipelinesView | null;
  options: string[];
  repository: string | null;
  repositories: readonly string[];
  api: Api | undefined;
  linkChoices: (kind: LinkKind) => LinkTargetGroup[];
  autoDeliverDefault: boolean | null;
  deliveryModeDefault: DeliveryMode | null;
  projectsPanel?: ReactNode;
  returnedRun?: string | null;
  providerError?: string | undefined;
}) {
  const { state, pipelines, repository, api } = props;
  const { t } = useTranslation();
  return (
    <div className="flex min-w-0 flex-col gap-4 rounded-lg bg-muted/40 p-3">
      {state.several && props.projectsPanel ? (
        <FormSection title={t('queue.form.sectionProjects')}>{props.projectsPanel}</FormSection>
      ) : null}
      <FormSection title={t('queue.form.sectionRun')}>
        <RunFields
          state={state}
          pipelines={pipelines}
          options={props.options}
          api={api}
          repositories={props.repositories}
          providerError={props.providerError}
        />
      </FormSection>
      <div className="flex min-w-0 flex-col gap-3 border-t pt-3">
        <LinksEditor
          value={state.effective.links}
          choices={props.linkChoices}
          editableKinds={state.locked || state.several ? ['blocked_by'] : undefined}
          legendClassName={SECTION_LEGEND}
          onChange={(links) => state.change({ links, linksTouched: true })}
        />
        {props.returnedRun && state.effective.links.some((link) => link.kind !== 'blocked_by') ? (
          <a
            className="text-sm text-primary underline"
            href={formatRoute({
              view: 'runs',
              run: props.returnedRun,
              group: null,
              step: null,
              tab: null,
            })}
          >
            {t('links.editRun')}
          </a>
        ) : null}
      </div>
      {state.several ? null : (
        <FormSection title={t('queue.form.sectionTags')}>
          <TagsField state={state} repository={repository} api={api} />
        </FormSection>
      )}
      <FormSection title={t('queue.form.sectionDelivery')}>
        <DeliveryFields
          state={state}
          autoDeliverDefault={props.autoDeliverDefault}
          deliveryModeDefault={props.deliveryModeDefault}
        />
      </FormSection>
    </div>
  );
}
