import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { NewConnection } from '../../../shared/api/integrations/integrationsApi.ts';
import type { IntegrationTypeView, RepositoryView } from '../../../shared/api/types.ts';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { Input } from '../../../shared/ui/forms/input.tsx';
import { Label } from '../../../shared/ui/forms/label.tsx';
import { SelectField } from '../SelectField.tsx';
import { ParamField } from './ParamField.tsx';

/** The parameters that were filled in, trimmed. */
const trimmed = (params: Record<string, string>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(params)
      .map(([key, value]) => [key, value.trim()] as const)
      .filter(([, value]) => value !== ''),
  );

function KindParams({
  type,
  prefix,
  params,
  onParams,
}: {
  type: IntegrationTypeView;
  prefix: string;
  params: Record<string, string>;
  onParams: (params: Record<string, string>) => void;
}) {
  if (type.params.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-3">
      {type.params.map((param) => (
        <ParamField
          key={param.name}
          kind={type.kind}
          prefix={prefix}
          param={param}
          value={params[param.name] ?? ''}
          onChange={(value) => onParams({ ...params, [param.name]: value })}
        />
      ))}
    </div>
  );
}

function NameAndScope({
  prefix,
  name,
  onName,
  repository,
  onRepository,
  registry,
}: {
  prefix: string;
  name: string;
  onName: (name: string) => void;
  repository: string;
  onRepository: (path: string) => void;
  registry: readonly RepositoryView[];
}) {
  const { t } = useTranslation();
  return (
    <>
      <div className="flex min-w-48 flex-col gap-1">
        <Label htmlFor={`${prefix}-name`}>{t('integrations.connections.add.name')}</Label>
        <Input
          id={`${prefix}-name`}
          value={name}
          maxLength={40}
          aria-describedby={`${prefix}-name-hint`}
          onChange={(event) => onName(event.target.value)}
        />
        <p id={`${prefix}-name-hint`} className="max-w-64 text-xs text-muted-foreground">
          {t('integrations.connections.add.nameHint')}
        </p>
      </div>
      <SelectField
        id={`${prefix}-scope`}
        label={t('integrations.connections.add.scope')}
        value={repository}
        onChange={onRepository}
      >
        <option value="">{t('integrations.scope.global')}</option>
        {registry.map((project) => (
          <option key={project.path} value={project.path}>
            {project.label}
          </option>
        ))}
      </SelectField>
    </>
  );
}

/**
 * The form of a new connection of one kind: name, where it works and the non-secret parameters of
 * the kind. The secret is not asked for: the card of the new connection shows the command that sets it.
 * The draft is state of this form, so a reload of the list or a refusal does not clear it.
 */
export function NewConnectionForm({
  type,
  registry,
  onCreate,
}: {
  type: IntegrationTypeView;
  registry: readonly RepositoryView[];
  /** Makes the connection; true when it went through (the form is cleared then). */
  onCreate: (connection: NewConnection) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [repository, setRepository] = useState('');
  const [params, setParams] = useState<Record<string, string>>({});
  const prefix = `new-${type.kind}`;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const given = trimmed(params);
    void onCreate({
      kind: type.kind,
      name: name.trim(),
      ...(repository === '' ? {} : { repository }),
      ...(Object.keys(given).length === 0 ? {} : { params: given }),
    }).then((done) => {
      if (!done) return;
      setName('');
      setParams({});
    });
  };

  return (
    <form
      aria-label={t('integrations.connections.add.title')}
      className="flex flex-col gap-3 rounded-lg border bg-card p-3"
      onSubmit={submit}
    >
      <h3 className="text-sm font-semibold">{t('integrations.connections.add.title')}</h3>
      <div className="flex flex-wrap gap-3">
        <NameAndScope
          prefix={prefix}
          name={name}
          onName={setName}
          repository={repository}
          onRepository={setRepository}
          registry={registry}
        />
      </div>
      <KindParams type={type} prefix={prefix} params={params} onParams={setParams} />
      <p className="text-xs text-muted-foreground">
        {t('integrations.connections.add.secretNote')}
      </p>
      <div>
        <Button type="submit" size="sm" disabled={name.trim() === ''}>
          {t('integrations.connections.add.create')}
        </Button>
      </div>
    </form>
  );
}
