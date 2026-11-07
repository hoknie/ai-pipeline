import { useTranslation } from 'react-i18next';

import { notifySuccess } from '../../../../shared/lib/browser/notify.ts';
import { ApplyDialog } from '../../header/ApplyDialog.tsx';
import { MessageDialog } from '../MessageDialog.tsx';
import type { GroupCtx } from './useGroupCtx.ts';

/** The dialog to write to the specialist and the one to deliver by force. */
export function GroupDialogs({ ctx }: { ctx: GroupCtx }) {
  const { t } = useTranslation();
  const { api, runId, row, run, messaging, onError } = ctx;
  return (
    <>
      {messaging !== null ? (
        <MessageDialog
          onSend={async (text) => {
            try {
              await api.message(runId, row.slug, messaging, text);
            } catch (error) {
              onError((error as Error).message);
              throw error;
            }
            notifySuccess(t('runs.message.sent'));
          }}
          onClose={() => ctx.setMessaging(null)}
        />
      ) : null}
      {ctx.forcing && run ? (
        <ApplyDialog
          run={run}
          api={api}
          onConfirm={() => {
            ctx.setForcing(false);
            void ctx.act(() =>
              ctx.onForceDeliver ? ctx.onForceDeliver() : api.apply(run.id, true),
            );
          }}
          onClose={() => ctx.setForcing(false)}
        />
      ) : null}
    </>
  );
}
