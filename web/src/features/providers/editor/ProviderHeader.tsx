import { useTranslation } from 'react-i18next';

import type { ProviderView } from '../../../shared/api/types.ts';
import { formatRoute } from '../../../shared/lib/nav/route.ts';
import { Badge } from '../../../shared/ui/feedback/badge.tsx';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { FilePath } from '../../../shared/ui/layout/FilePath.tsx';
import { DefaultMark } from '../list/DefaultMark.tsx';
import { ProviderStatusBadge } from '../list/ProviderStatus.tsx';
import { reasonsOf } from '../list/ProvidersList.tsx';
import { useProvidersScope } from '../page/scope.ts';
import type { DefaultProviderState } from './useDefaultProvider.ts';
import { DefaultProviderSwitch } from './DefaultProviderSwitch.tsx';

/** Why a shared provider cannot be edited in the project, and what its project copy leaves out. */
function LockedNotice({ strips }: { strips: boolean }) {
  const { t } = useTranslation();
  return (
    <>
      <p role="status" className="text-sm text-muted-foreground">
        {t('providers.sharedReadOnly')}
      </p>
      {strips ? <p className="text-sm text-status-warn">{t('providers.overrideStrips')}</p> : null}
    </>
  );
}

/** The buttons of the bar: «Override in the project» for a shared provider, else Save and Delete. */
function HeaderButtons(props: {
  slug: string;
  busy: boolean;
  canSave: boolean;
  locked: boolean;
  overriding: boolean;
  scope: 'project' | 'global';
  onSave: () => void;
  onDelete: () => void;
  onOverride: () => void;
}) {
  const { t } = useTranslation();
  const { busy, slug, scope } = props;
  return props.locked ? (
    <div className="flex flex-wrap gap-2">
      <Button disabled={busy} onClick={props.onOverride}>
        {t('providers.override')}
      </Button>
      <Button variant="outline" asChild>
        <a
          href={formatRoute({
            view: 'settings',
            run: 'swarm',
            group: 'global',
            step: slug,
            tab: 'providers',
          })}
        >
          {t('providers.editInSettings')}
        </a>
      </Button>
    </div>
  ) : (
    <div className="flex flex-wrap gap-2">
      <Button disabled={busy || !props.canSave} onClick={props.onSave}>
        {t('providers.form.save')}
      </Button>
      <Button variant="destructive" disabled={busy} onClick={props.onDelete}>
        {props.overriding && scope === 'project'
          ? t('providers.removeOverride')
          : t('providers.form.delete')}
      </Button>
    </div>
  );
}

/** The sticky bar of an existing provider: name, slug, level, status, file, and Save and Delete. */
export function ProviderHeader(props: {
  slug: string;
  /** The provider as the registry has it; undefined while the registry does not list it. */
  live: ProviderView | undefined;
  draftName: string;
  busy: boolean;
  canSave: boolean;
  onSave: () => void;
  onDelete: () => void;
  /** The default provider of the scope, for the mark and the switch. */
  defaults: DefaultProviderState;
  /** The project scope may only look at the provider: it exists at the shared level alone. */
  locked: boolean;
  /** A project file overrides a shared one: Delete only removes the override. */
  overriding: boolean;
  /** The project copy would leave out `command` and `args` of the shared file. */
  strips: boolean;
  onOverride: () => void;
}) {
  const { t } = useTranslation();
  const scope = useProvidersScope();
  const { live, slug, busy } = props;
  const name = live?.name || props.draftName || slug;
  return (
    <header
      role="toolbar"
      aria-label={t('providers.header')}
      data-sticky
      // -top-4/-mt-4/-mx-4 cancel the p-4 of the right part, so no strip of scrolled content shows above
      className="sticky -top-4 z-10 -mx-4 -mt-4 flex flex-col gap-2 border-b bg-background px-4 py-2"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="min-w-0 break-words text-lg font-semibold">{name}</h2>
        <code className="text-xs text-muted-foreground">{slug}</code>
        {live ? <Badge variant="outline">{t(`providers.level.${live.level}`)}</Badge> : null}
        {live ? <ProviderStatusBadge status={live.status} reasons={reasonsOf(live)} /> : null}
        {live && props.defaults.current?.slug === slug ? (
          <DefaultMark level={props.defaults.current.level} enabled={live.enabled} />
        ) : null}
      </div>
      {live?.file ? <FilePath variant="line" path={live.file} /> : null}
      {scope === 'global' ? (
        <p className="text-sm text-muted-foreground">{t('providers.globalWarning')}</p>
      ) : null}
      {props.locked ? <LockedNotice strips={props.strips} /> : null}
      {live ? <DefaultProviderSwitch provider={live} state={props.defaults} /> : null}
      <HeaderButtons {...props} scope={scope} />
    </header>
  );
}
