import {
  Bold,
  Code,
  Code2,
  Heading2,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  Quote,
  Strikethrough,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../lib/browser/cn.ts';
import type { MarkupAction } from '../../lib/markdown/markdownMarkup.ts';
import { Toolbar, ToolbarButton, ToolbarSeparator } from '../layout/toolbar.tsx';

const ACTIONS: { action: MarkupAction; icon: LucideIcon; separated?: boolean }[] = [
  { action: 'heading', icon: Heading2 },
  { action: 'bold', icon: Bold },
  { action: 'italic', icon: Italic },
  { action: 'strike', icon: Strikethrough },
  { action: 'bulletList', icon: List, separated: true },
  { action: 'numberedList', icon: ListOrdered },
  { action: 'taskList', icon: ListChecks },
  { action: 'quote', icon: Quote },
  { action: 'code', icon: Code, separated: true },
  { action: 'codeBlock', icon: Code2 },
  { action: 'link', icon: Link },
];

/** Formatting actions and the source toggle of a Markdown field. */
export function MarkupToolbar({
  editing,
  source,
  onSource,
  onMark,
}: {
  editing: boolean;
  source: boolean;
  onSource: () => void;
  onMark: (action: MarkupAction) => void;
}) {
  const { t } = useTranslation();
  const caption = (action: MarkupAction) => t(`queue.form.markup.${action}`);
  return (
    <Toolbar aria-label={t('queue.form.markupToolbar')}>
      {ACTIONS.map(({ action, icon: Icon, separated }) => (
        <span key={action} className="contents">
          {separated ? <ToolbarSeparator /> : null}
          <ToolbarButton
            aria-label={caption(action)}
            title={caption(action)}
            disabled={!editing || source}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onMark(action)}
          >
            <Icon aria-hidden />
          </ToolbarButton>
        </span>
      ))}
      <ToolbarButton
        className={cn('ml-auto w-auto px-2', source && 'bg-accent text-foreground')}
        aria-pressed={source}
        title={t('queue.form.markdownSource')}
        onClick={onSource}
      >
        <Code2 aria-hidden />
        {t('queue.form.markdownSource')}
      </ToolbarButton>
    </Toolbar>
  );
}
