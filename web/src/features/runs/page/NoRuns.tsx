import { Inbox } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { Route } from '../../../shared/lib/nav/route.ts';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { Empty } from '../../../shared/ui/feedback/empty.tsx';

/** The screen of a daemon without runs: how to start one and the way to the queue. */
export function NoRuns({ onRoute }: { onRoute: (route: Route) => void }) {
  const { t } = useTranslation();
  return (
    <Empty icon={<Inbox />} title={t('runs.page.noRuns')} className="m-auto">
      <p>
        {t('runs.page.startWith')}{' '}
        <code className="font-mono">aip run start feature --task "…"</code>.
      </p>
      <Button variant="outline" size="sm" asChild>
        <a
          href="#queue"
          onClick={(event) => {
            event.preventDefault();
            onRoute({ view: 'queue', run: null, group: null, step: null, tab: null });
          }}
        >
          {t('runs.page.openQueue')}
        </a>
      </Button>
    </Empty>
  );
}
