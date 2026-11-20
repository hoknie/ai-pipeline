import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ConnectionView } from '../../../shared/api/types.ts';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { ParamField, paramsChange, type Param } from './ParamField.tsx';

/** The non-secret parameters of a connection: the fields and the button that saves what changed. */
export function ParamsForm({
  connection,
  params,
  onEdit,
}: {
  connection: ConnectionView;
  params: readonly Param[];
  onEdit: (
    id: string,
    change: { set: Record<string, string>; unset: string[] },
  ) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Record<string, string>>({});
  if (params.length === 0) return null;
  const change = paramsChange(params, connection.params, draft);
  const changed = Object.keys(change.set).length + change.unset.length > 0;
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void onEdit(connection.id, change).then((done) => done && setDraft({}));
      }}
    >
      <div className="flex flex-wrap gap-3">
        {params.map((param) => (
          <ParamField
            key={param.name}
            param={param}
            value={draft[param.name] ?? connection.params[param.name] ?? ''}
            onChange={(value) => setDraft({ ...draft, [param.name]: value })}
          />
        ))}
      </div>
      <div>
        <Button type="submit" size="sm" disabled={!changed}>
          {t('integrations.params.save')}
        </Button>
      </div>
    </form>
  );
}
