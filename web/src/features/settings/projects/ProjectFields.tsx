import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Input } from '../../../shared/ui/forms/input.tsx';
import { Label } from '../../../shared/ui/forms/label.tsx';
import { Switch } from '../../../shared/ui/forms/switch.tsx';
import { ColorField } from './ColorField.tsx';
import type { ProjectDraft, ProjectField } from './projectDraft.ts';

export type FieldErrors = Partial<Record<ProjectField, string>>;

/** A field of the form: the label, the control, an explanation and the error of the daemon. */
export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5" data-field={id}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Name, slug and color of a project; `enabled` only for a project that exists. */
export function ProjectFields({
  draft,
  onDraft,
  errors,
  namePlaceholder,
  withEnabled,
}: {
  draft: ProjectDraft;
  onDraft: (draft: ProjectDraft) => void;
  errors: FieldErrors;
  namePlaceholder: string;
  withEnabled: boolean;
}) {
  const { t } = useTranslation();
  const set = (patch: Partial<ProjectDraft>) => onDraft({ ...draft, ...patch });
  return (
    <>
      <Field
        id="project-name"
        label={t('projects.fields.name')}
        hint={t('projects.hints.name')}
        error={errors.name}
      >
        <Input
          id="project-name"
          value={draft.name}
          placeholder={namePlaceholder}
          maxLength={80}
          aria-invalid={errors.name !== undefined}
          onChange={(event) => set({ name: event.target.value })}
        />
      </Field>
      <Field
        id="project-slug"
        label={t('projects.fields.slug')}
        hint={t('projects.hints.slug')}
        error={errors.slug}
      >
        <Input
          id="project-slug"
          value={draft.slug}
          placeholder={withEnabled ? undefined : t('projects.hints.slugAuto')}
          maxLength={40}
          aria-invalid={errors.slug !== undefined}
          onChange={(event) => set({ slug: event.target.value })}
        />
      </Field>
      {withEnabled ? (
        <Field
          id="project-enabled"
          label={t('projects.fields.enabled')}
          hint={t('projects.hints.enabled')}
        >
          <Switch
            id="project-enabled"
            checked={draft.enabled}
            onCheckedChange={(enabled) => set({ enabled })}
          />
        </Field>
      ) : null}
      <Field id="project-color" label={t('projects.fields.color')} error={errors.color}>
        <ColorField
          id="project-color"
          value={draft.color}
          invalid={errors.color !== undefined}
          onChange={(color) => set({ color })}
        />
      </Field>
    </>
  );
}
