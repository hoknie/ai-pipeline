import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../api.ts';
import { notifySuccess } from '../../notify.ts';
import type { ObserverSettings, ObserversView } from '../../observerTypes.ts';
import { repositoryLabel } from '../../repositories.ts';
import { OBSERVER_TABS, type ObserverTab } from '../../settingsGroups.ts';
import type { ConfigCatalogResponse, ConfigEditorResponse, FieldError } from '../../types.ts';
import { Alert } from '../../ui/alert.tsx';
import { Button } from '../../ui/button.tsx';
import { Card } from '../../ui/card.tsx';
import { Input } from '../../ui/input.tsx';
import { Label } from '../../ui/label.tsx';
import { Skeleton } from '../../ui/skeleton.tsx';
import { Switch } from '../../ui/switch.tsx';
import { Tabs, TabsList, TabsTrigger } from '../../ui/tabs.tsx';
import { SpecialistFields, draftOf, fieldOf, valueOf, type Draft } from '../SpecialistFields.tsx';

/** The fields of a specialist file the observer's specialist has no place for. */
const NOT_OBSERVER_FIELDS = ['max', 'tags', 'queue'];
const SPECIALIST_PREFIX = 'specialist.';

interface ProjectDraft {
  connected: boolean;
  /** Empty: no limit of the project's own. */
  maxWorkers: string;
}

interface Form {
  enabled: boolean;
  workers: string;
  maxRepairs: string;
  answerHumanOnly: boolean;
  specialist: Draft;
  projects: Record<string, ProjectDraft>;
}

function formOf(settings: ObserverSettings): Form {
  const projects: Record<string, ProjectDraft> = {};
  for (const project of settings.projects) {
    projects[project.repository] = {
      connected: true,
      maxWorkers: project.maxWorkers === null ? '' : String(project.maxWorkers),
    };
  }
  return {
    enabled: settings.enabled,
    workers: String(settings.workers),
    maxRepairs: String(settings.maxRepairs),
    answerHumanOnly: settings.answerHumanOnly,
    specialist: draftOf(settings.specialist),
    projects,
  };
}

/** The form as compared for edits: a project switched on and off again is no edit. */
const keyOf = (form: Form): string =>
  JSON.stringify({
    ...form,
    projects: Object.fromEntries(
      Object.entries(form.projects).filter(
        ([, project]) => project.connected || project.maxWorkers !== '',
      ),
    ),
  });

const numberOf = (text: string): number => (text.trim() === '' ? Number.NaN : Number(text.trim()));

/** The settings a form stands for, with the connected projects in the order of the registry. */
function settingsOf(form: Form, order: string[], raw: Record<string, unknown>): ObserverSettings {
  const known = new Set(order);
  const repositories = [
    ...order,
    ...Object.keys(form.projects).filter((repository) => !known.has(repository)),
  ];
  const specialist = Object.fromEntries(
    Object.entries(valueOf(form.specialist, raw)).filter(
      ([key]) => !NOT_OBSERVER_FIELDS.includes(key),
    ),
  );
  return {
    enabled: form.enabled,
    workers: numberOf(form.workers),
    maxRepairs: numberOf(form.maxRepairs),
    answerHumanOnly: form.answerHumanOnly,
    projects: repositories.flatMap((repository) => {
      const project = form.projects[repository];
      if (!project?.connected) return [];
      return [
        {
          repository,
          maxWorkers: project.maxWorkers.trim() === '' ? null : numberOf(project.maxWorkers),
        },
      ];
    }),
    specialist,
  };
}

function Errors({ errors }: { errors: FieldError[] }) {
  return errors.map((error) => (
    <p className="text-sm text-destructive" role="alert" key={`${error.path}:${error.message}`}>
      {error.message}
    </p>
  ));
}

/**
 * The group «Observers» of the shared tab: the switch and limits, the specialist of the observer
 * and the projects it works in. The three tabs edit one form, saved in one go.
 */
export function ObserversGroup({
  api,
  tab,
  onTab,
  streamed,
  repositories,
  onDirty,
}: {
  api: Api;
  tab: ObserverTab;
  onTab: (tab: ObserverTab) => void;
  /** The last `observers` event of the stream: the settings changed elsewhere. */
  streamed: ObserversView | null;
  /** The repositories of the registry, the choices of the tab «Projects». */
  repositories: string[];
  onDirty: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const [view, setView] = useState<ObserversView | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [saved, setSaved] = useState<string>('');
  const [config, setConfig] = useState<ConfigEditorResponse | null>(null);
  const [catalog, setCatalog] = useState<ConfigCatalogResponse | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [busy, setBusy] = useState(false);
  /** The repositories of the projects as sent: the numbers of the server's errors count them. */
  const [sent, setSent] = useState<string[]>([]);
  const rawSpecialist = useRef<Record<string, unknown>>({});

  const adopt = (next: ObserversView) => {
    rawSpecialist.current = next.settings.specialist;
    const fresh = formOf(next.settings);
    setView(next);
    setForm(fresh);
    setSaved(keyOf(fresh));
  };

  useEffect(() => {
    let closed = false;
    api
      .observers()
      .then((next) => {
        if (!closed) adopt(next);
      })
      .catch((error: Error) => {
        if (!closed) setFailure(error.message);
      });
    api
      .config()
      .then((next) => {
        if (!closed) setConfig(next);
      })
      .catch(() => undefined);
    api
      .catalog()
      .then((next) => {
        if (!closed) setCatalog(next);
      })
      .catch((error: Error) => {
        if (!closed) setCatalogError(error.message);
      });
    return () => {
      closed = true;
    };
  }, [api]);

  const dirty = form !== null && keyOf(form) !== saved;
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);

  // Settings changed in another tab of the browser: the form follows unless it has edits.
  useEffect(() => {
    if (streamed === null) return;
    if (dirty) {
      setView((current) => (current ? { ...current, workers: streamed.workers } : current));
      return;
    }
    adopt(streamed);
    // only a new event matters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamed]);

  const defaults = useMemo(
    () =>
      Object.fromEntries(
        (config?.settings ?? [])
          .filter((setting) => setting.path.startsWith('defaults.'))
          .map((setting) => [setting.path, setting.globalValue]),
      ),
    [config],
  );

  const order = useMemo(() => [...new Set(repositories)], [repositories]);
  const submitted = form ? settingsOf(form, order, rawSpecialist.current) : null;

  const save = async () => {
    if (!form || !submitted) return;
    setBusy(true);
    setProblem(null);
    setErrors([]);
    setSent(submitted.projects.map((project) => project.repository));
    try {
      const result = await api.setObservers(submitted);
      if (result.ok) {
        adopt(result.view);
        notifySuccess(t('observers.saved'));
      } else {
        setErrors(result.errors);
      }
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (failure) return <Alert variant="destructive">{failure}</Alert>;
  if (!form || !view || !submitted) {
    return (
      <div role="status" aria-label={t('observers.loading')}>
        <Skeleton className="h-40" />
      </div>
    );
  }

  const update = (patch: Partial<Form>) => setForm({ ...form, ...patch });
  const at = (path: string) => errors.filter((error) => error.path === path);
  const specialistErrors = errors.filter((error) => error.path.startsWith(SPECIALIST_PREFIX));
  const projectPath = /^projects\[(\d+)\]\.maxWorkers$/;
  const projectOf = (path: string): string | null => {
    const match = projectPath.exec(path);
    const repository = match ? sent[Number(match[1])] : undefined;
    return repository !== undefined && order.includes(repository) ? repository : null;
  };
  const projectErrors = (repository: string) =>
    errors.filter((error) => projectOf(error.path) === repository);
  const known = (error: FieldError) =>
    error.path === 'workers' ||
    error.path === 'maxRepairs' ||
    projectOf(error.path) !== null ||
    (error.path.startsWith(SPECIALIST_PREFIX) && fieldOf(error.path, SPECIALIST_PREFIX) !== null);
  const otherErrors = errors.filter((error) => !known(error));
  const tabHasErrors = (key: ObserverTab) =>
    key === 'general'
      ? at('workers').length + at('maxRepairs').length > 0
      : key === 'specialist'
        ? specialistErrors.length > 0
        : errors.some((error) => projectOf(error.path) !== null);

  const { running, waiting } = view.workers;

  return (
    <div className="flex flex-col gap-3">
      <Tabs value={tab} onValueChange={(next) => onTab(next as ObserverTab)}>
        <TabsList aria-label={t('observers.tabs.label')}>
          {OBSERVER_TABS.map((key) => (
            <TabsTrigger key={key} value={key}>
              {t(`observers.tabs.${key}`)}
              {tabHasErrors(key) ? (
                <span className="ml-1 rounded-full bg-destructive px-1.5 text-xs text-destructive-foreground">
                  !<span className="sr-only">{t('settingsPage.hasErrors')}</span>
                </span>
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {problem ? <Alert variant="destructive">{problem}</Alert> : null}
      {otherErrors.length > 0 ? (
        <Alert variant="destructive">
          <ul>
            {otherErrors.map((error) => (
              <li key={`${error.path}:${error.message}`}>
                <code>{error.path}</code>: {error.message}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {tab === 'general' ? (
        <>
          <Card>
            <section className="flex flex-col gap-4 p-4" aria-label={t('observers.tabs.general')}>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <Switch
                    id="observers-enabled"
                    checked={form.enabled}
                    disabled={busy}
                    onCheckedChange={(enabled) => update({ enabled })}
                  />
                  <Label htmlFor="observers-enabled">{t('observers.enabled.label')}</Label>
                </div>
                <p className="text-xs text-muted-foreground">{t('observers.enabled.hint')}</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="observers-workers">{t('observers.workers.label')}</Label>
                <Input
                  id="observers-workers"
                  type="number"
                  min={1}
                  max={20}
                  className="w-32"
                  value={form.workers}
                  disabled={busy}
                  aria-invalid={at('workers').length > 0}
                  onChange={(event) => update({ workers: event.target.value })}
                />
                <p className="text-xs text-muted-foreground">{t('observers.workers.hint')}</p>
                <Errors errors={at('workers')} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="observers-max-repairs">{t('observers.maxRepairs.label')}</Label>
                <Input
                  id="observers-max-repairs"
                  type="number"
                  min={1}
                  max={50}
                  className="w-32"
                  value={form.maxRepairs}
                  disabled={busy}
                  aria-invalid={at('maxRepairs').length > 0}
                  onChange={(event) => update({ maxRepairs: event.target.value })}
                />
                <p className="text-xs text-muted-foreground">{t('observers.maxRepairs.hint')}</p>
                <Errors errors={at('maxRepairs')} />
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <Switch
                    id="observers-human-only"
                    checked={form.answerHumanOnly}
                    disabled={busy}
                    onCheckedChange={(answerHumanOnly) => update({ answerHumanOnly })}
                  />
                  <Label htmlFor="observers-human-only">{t('observers.humanOnly.label')}</Label>
                </div>
                <p className="text-xs text-muted-foreground">{t('observers.humanOnly.hint')}</p>
              </div>
            </section>
          </Card>
          <Card>
            <section
              className="flex flex-col gap-2 p-4"
              aria-label={t('observers.running.title')}
              data-testid="observers-running"
            >
              <h3 className="text-sm font-semibold">{t('observers.running.title')}</h3>
              {running.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('observers.running.none')}</p>
              ) : (
                <ul className="flex flex-col gap-1 text-sm">
                  {running.map((item) => (
                    <li key={`${item.runId}:${item.incident.key}`}>
                      <span className="font-medium" title={item.repository}>
                        {repositoryLabel(item.repository)}
                      </span>{' '}
                      · <code>{item.runId}</code> · {t(`observers.incident.${item.incident.kind}`)}{' '}
                      · {item.incident.group}
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-sm text-muted-foreground" data-testid="observers-waiting">
                {t('observers.running.waiting', { count: waiting })}
              </p>
            </section>
          </Card>
        </>
      ) : null}

      {tab === 'specialist' ? (
        <>
          <p className="text-sm text-muted-foreground">{t('observers.specialist.hint')}</p>
          <SpecialistFields
            draft={form.specialist}
            onDraft={(change) =>
              setForm(
                (current) => current && { ...current, specialist: change(current.specialist) },
              )
            }
            disabled={busy}
            errors={specialistErrors}
            prefix={SPECIALIST_PREFIX}
            defaults={defaults}
            catalog={catalog}
            catalogError={catalogError}
            omit={['max', 'tags']}
          />
        </>
      ) : null}

      {tab === 'projects' ? (
        <Card>
          <section className="flex flex-col gap-3 p-4" aria-label={t('observers.tabs.projects')}>
            <p className="text-sm text-muted-foreground">{t('observers.projects.hint')}</p>
            {order.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('observers.projects.empty')}</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {order.map((repository, index) => {
                  const project = form.projects[repository] ?? { connected: false, maxWorkers: '' };
                  const name = repositoryLabel(repository);
                  const own = projectErrors(repository);
                  const change = (patch: Partial<ProjectDraft>) =>
                    update({
                      projects: { ...form.projects, [repository]: { ...project, ...patch } },
                    });
                  return (
                    <li key={repository} className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-2">
                        <Switch
                          id={`observers-project-${index}`}
                          checked={project.connected}
                          disabled={busy}
                          aria-label={t('observers.projects.connect', { name })}
                          onCheckedChange={(connected) => change({ connected })}
                        />
                        <Label htmlFor={`observers-project-${index}`} title={repository}>
                          {name}
                        </Label>
                        <code className="truncate text-xs text-muted-foreground">{repository}</code>
                      </div>
                      <div className="flex items-center gap-2 pl-11">
                        <Label htmlFor={`observers-project-workers-${index}`} className="text-xs">
                          {t('observers.projects.maxWorkers')}
                        </Label>
                        <Input
                          id={`observers-project-workers-${index}`}
                          type="number"
                          min={1}
                          className="w-24"
                          value={project.maxWorkers}
                          disabled={busy || !project.connected}
                          aria-label={t('observers.projects.maxWorkersOf', { name })}
                          aria-invalid={own.length > 0}
                          onChange={(event) => change({ maxWorkers: event.target.value })}
                        />
                      </div>
                      <div className="pl-11">
                        <Errors errors={own} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </Card>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button loading={busy} disabled={!dirty} onClick={() => void save()}>
          {t('settingsPage.save')}
        </Button>
        <Button
          variant="outline"
          disabled={busy || !dirty}
          onClick={() => {
            setErrors([]);
            setForm(formOf({ ...view.settings, specialist: rawSpecialist.current }));
          }}
        >
          {t('settingsPage.discard')}
        </Button>
      </div>
    </div>
  );
}
