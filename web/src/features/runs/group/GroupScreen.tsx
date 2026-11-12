import { useState } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

import { useElementHeight } from '../../../shared/lib/browser/useElementHeight.ts';
import { DeliveryFailed } from './screen/DeliveryFailed.tsx';
import { GroupDialogs } from './screen/GroupDialogs.tsx';
import { GroupHeader } from './screen/GroupHeader.tsx';
import { GroupNotices } from './screen/GroupNotices.tsx';
import { GroupTabsView } from './screen/GroupTabsView.tsx';
import type { GroupScreenProps } from './screen/types.ts';
import { useGroupCtx } from './screen/useGroupCtx.ts';

/** The screen of a group or a system step: header, what waits for a person, and the tabs. */
export function GroupScreen(props: GroupScreenProps) {
  const { t } = useTranslation();
  const [section, setSection] = useState<HTMLElement | null>(null);
  const ctx = useGroupCtx(props, section);
  const [header, setHeader] = useState<HTMLElement | null>(null);
  const headerHeight = useElementHeight(header);
  return (
    <section
      ref={setSection}
      aria-label={t('runs.group.label', { title: ctx.title })}
      className="flex flex-col gap-3 p-4"
      style={{ '--group-header-height': `${headerHeight}px` } as CSSProperties}
    >
      <GroupHeader ctx={ctx} onHeight={setHeader} />
      <DeliveryFailed ctx={ctx} />
      <GroupDialogs ctx={ctx} />
      <GroupNotices ctx={ctx} />
      <GroupTabsView ctx={ctx} />
    </section>
  );
}
