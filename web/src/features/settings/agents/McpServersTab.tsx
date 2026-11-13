import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import type { ConfigEditorResponse } from '../../../shared/api/types.ts';
import type { SettingsScope } from '../../../shared/lib/nav/settingsGroups.ts';
import { Alert } from '../../../shared/ui/feedback/alert.tsx';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { Dialog, DialogContent, DialogTitle } from '../../../shared/ui/overlays/dialog.tsx';
import { McpServerForm, type McpFormMode } from './McpServerForm.tsx';
import { useMcpServers, type McpRow } from './useMcpServers.ts';
import { useMcpServersTab, type OpenForm } from './useMcpServersTab.ts';

function Row({
  row,
  scope,
  onOpen,
  onRestore,
}: {
  row: McpRow;
  scope: SettingsScope;
  onOpen: (mode: McpFormMode) => void;
  onRestore: () => void;
}) {
  const { t } = useTranslation();
  const overridden = scope === 'project' && row.level === 'project_over_global';
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm">
      <span className="font-medium">{row.name}</span>
      <code className="text-xs text-muted-foreground">{row.command}</code>
      <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
        {t(`settingsPage.mcp.source.${row.level}`)}
      </span>
      {row.allSpecialists ? (
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
          {t('settingsPage.mcp.allSpecialists')}
        </span>
      ) : null}
      <span className="text-xs text-muted-foreground">
        {t('settingsPage.mcp.specialists', { count: row.specialists })}
      </span>
      <span className="ml-auto flex gap-1">
        {row.editable ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label={`${t('settingsPage.mcp.edit')} ${row.name}`}
            onClick={() => onOpen('edit')}
          >
            {t('settingsPage.mcp.edit')}
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label={`${t('settingsPage.mcp.override')} ${row.name}`}
            onClick={() => onOpen('override')}
          >
            {t('settingsPage.mcp.override')}
          </Button>
        )}
        {overridden ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={`${t('settingsPage.mcp.restore')} ${row.name}`}
            onClick={onRestore}
          >
            {t('settingsPage.mcp.restore')}
          </Button>
        ) : null}
      </span>
    </li>
  );
}

function FormDialog({
  open,
  failure,
  current,
  names,
  onSave,
  onRemove,
  onClose,
  onLeave,
  onDirty,
}: {
  open: OpenForm;
  failure: string | null;
  current: McpRow | null;
  names: string[];
  onSave: ComponentProps<typeof McpServerForm>['onSave'];
  onRemove: (name: string) => Promise<void>;
  onClose: () => void;
  onLeave: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={open !== null}
      onOpenChange={(next) => {
        if (!next) onLeave();
      }}
    >
      <DialogContent aria-describedby={undefined} className="max-w-2xl">
        <DialogTitle>{t('settingsPage.mcp.formLabel')}</DialogTitle>
        {failure ? (
          <Alert variant="destructive" className="whitespace-pre-line">
            {failure}
          </Alert>
        ) : null}
        {open ? (
          <McpServerForm
            key={`${open.mode}/${open.name ?? ''}`}
            mode={open.mode}
            initial={current}
            names={names}
            onSave={onSave}
            onRemove={
              open.mode === 'edit' && open.name !== null ? () => onRemove(open.name ?? '') : null
            }
            onClose={onClose}
            onDirty={onDirty}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The tab «MCP servers» of the group «Agents»: the servers of the catalog and the form of one of
 * them. It reads and writes the level of the page tab; a shared server on the project tab is
 * offered for an override.
 */
export function McpServersTab({
  api,
  scope,
  config,
  reload,
  onDirty,
}: {
  api: Api;
  scope: SettingsScope;
  config: ConfigEditorResponse;
  reload: () => Promise<void>;
  onDirty: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const { rows, save, remove } = useMcpServers(api, config, scope, reload);
  const { open, close, failure, guarded, removeServer, handleDirty } = useMcpServersTab(
    remove,
    onDirty,
  );
  const current = open?.name ? (rows.find((row) => row.name === open.name) ?? null) : null;

  return (
    <div className="flex flex-col gap-3">
      {failure && open === null ? (
        <Alert variant="destructive" className="whitespace-pre-line">
          {failure}
        </Alert>
      ) : null}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => void guarded({ mode: 'create', name: null })}
        >
          {t('settingsPage.mcp.newServer')}
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('settingsPage.mcp.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label={t('settingsPage.mcp.list')}>
          {rows.map((row) => (
            <Row
              key={row.name}
              row={row}
              scope={scope}
              onOpen={(mode) => void guarded({ mode, name: row.name })}
              onRestore={() => void removeServer(row.name, true)}
            />
          ))}
        </ul>
      )}
      <FormDialog
        open={open}
        failure={failure}
        current={current}
        names={rows.map((row) => row.name)}
        onSave={save}
        onRemove={(name) => removeServer(name, false)}
        onClose={close}
        onLeave={() => void guarded(null)}
        onDirty={handleDirty}
      />
    </div>
  );
}
