import { useTranslation } from 'react-i18next';

import type { ConfigEditResult, McpServerValue } from '../../../shared/api/types.ts';
import { Alert } from '../../../shared/ui/feedback/alert.tsx';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { McpServerFields } from './McpServerFields.tsx';
import { useMcpServerForm, type McpFormMode } from './useMcpServerForm.ts';
import type { McpRow } from './useMcpServers.ts';

export type { McpFormMode };

/**
 * The form of one server of the catalog: the name (only for a new one), the command, the
 * arguments, the variables and the switch for all specialists. The values of the variables are
 * never shown: a saved one is kept unless it is replaced or deleted.
 */
export function McpServerForm(props: {
  mode: McpFormMode;
  initial: McpRow | null;
  names: string[];
  onSave: (name: string, value: McpServerValue) => Promise<ConfigEditResult>;
  onRemove: (() => Promise<void>) | null;
  onClose: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const { mode, onRemove, onClose } = props;
  const form = useMcpServerForm(props);
  return (
    <form
      onSubmit={(event) => void form.submit(event)}
      className="flex flex-col gap-3"
      aria-label={t('settingsPage.mcp.formLabel')}
    >
      {mode === 'override' ? (
        <p className="text-xs text-muted-foreground">{t('settingsPage.mcp.overrideNote')}</p>
      ) : null}
      {form.problems.other.map((text) => (
        <Alert key={text} variant="destructive">
          {text}
        </Alert>
      ))}
      {form.conflict ? <Alert variant="destructive">{form.conflict}</Alert> : null}
      <McpServerFields mode={mode} form={form} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" loading={form.busy} disabled={!form.canSave}>
          {t('settingsPage.mcp.save')}
        </Button>
        <Button type="button" variant="outline" disabled={form.busy} onClick={onClose}>
          {t('settingsPage.mcp.cancel')}
        </Button>
        {onRemove ? (
          <Button
            type="button"
            variant="ghost"
            className="ml-auto text-destructive"
            disabled={form.busy}
            onClick={() => void onRemove()}
          >
            {t('settingsPage.mcp.delete')}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
