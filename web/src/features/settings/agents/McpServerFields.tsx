import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { Input } from '../../../shared/ui/forms/input.tsx';
import { Label } from '../../../shared/ui/forms/label.tsx';
import { EnvField } from '../../../shared/ui/forms/settings/EnvField.tsx';
import { Switch } from '../../../shared/ui/forms/switch.tsx';
import { Textarea } from '../../../shared/ui/forms/textarea.tsx';
import type { McpFormMode, McpServerFormState } from './useMcpServerForm.ts';

function Problem({ text }: { text: string | null }) {
  return text ? <p className="text-xs text-destructive">{text}</p> : null;
}

/** The name, the command and the arguments of a server. */
function TextFields({ mode, form }: { mode: McpFormMode; form: McpServerFormState }) {
  const { t } = useTranslation();
  const id = useId();
  const { fields, set, problems, busy } = form;
  return (
    <>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${id}-name`}>{t('settingsPage.mcp.name')}</Label>
        <Input
          id={`${id}-name`}
          value={fields.name}
          disabled={mode !== 'create' || busy}
          aria-invalid={problems.name !== null}
          autoComplete="off"
          onChange={(event) => set.setName(event.target.value)}
        />
        <Problem text={problems.name} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${id}-command`}>{t('settingsPage.mcp.command')}</Label>
        <Input
          id={`${id}-command`}
          value={fields.command}
          disabled={busy}
          aria-invalid={problems.command !== null}
          autoComplete="off"
          onChange={(event) => set.setCommand(event.target.value)}
        />
        <Problem text={problems.command} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${id}-args`}>{t('settingsPage.mcp.args')}</Label>
        <Textarea
          id={`${id}-args`}
          value={fields.argsText}
          disabled={busy}
          aria-invalid={problems.args !== null}
          onChange={(event) => set.setArgsText(event.target.value)}
        />
        <Problem text={problems.args} />
      </div>
    </>
  );
}

/** The variables of a server and the switch for all specialists. */
function VariableFields({ form }: { form: McpServerFormState }) {
  const { t } = useTranslation();
  const id = useId();
  const { fields, set, problems, busy } = form;
  return (
    <>
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t('settingsPage.mcp.env')}</span>
        <EnvField
          runtime={fields.name === '' ? '…' : fields.name}
          names={fields.saved}
          drafts={fields.drafts}
          error={problems.env}
          disabled={busy}
          onSet={(variable, value) =>
            set.setDrafts((current) => ({ ...current, [variable]: value }))
          }
          onUndo={(variable) =>
            set.setDrafts((current) => {
              const { [variable]: _gone, ...rest } = current;
              return rest;
            })
          }
        />
        <p className="text-xs text-muted-foreground">{t('settingsPage.mcp.envNote')}</p>
      </div>
      <div className="flex items-center gap-2">
        <Switch
          id={`${id}-all`}
          checked={fields.allSpecialists}
          disabled={busy}
          onCheckedChange={set.setAllSpecialists}
        />
        <Label htmlFor={`${id}-all`}>{t('settingsPage.mcp.allSpecialists')}</Label>
      </div>
    </>
  );
}

/** All fields of the form of a server. */
export function McpServerFields({ mode, form }: { mode: McpFormMode; form: McpServerFormState }) {
  return (
    <>
      <TextFields mode={mode} form={form} />
      <VariableFields form={form} />
    </>
  );
}
