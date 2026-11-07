import {
  Bold,
  Code,
  Code2,
  Eye,
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
import {
  Toolbar,
  ToolbarButton,
  ToolbarSeparator,
  ToolbarToggleGroup,
  ToolbarToggleItem,
} from '../layout/toolbar.tsx';

export type Mode = 'plain' | 'markdown';

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

/** The switch of the display, the markup buttons and the preview toggle of a Markdown field. */
export function MarkupToolbar({
  mode,
  onMode,
  editing,
  preview,
  onPreview,
  onMark,
}: {
  mode: Mode;
  onMode: (mode: string) => void;
  editing: boolean;
  preview: boolean;
  onPreview: () => void;
  onMark: (action: MarkupAction) => void;
}) {
  const { t } = useTranslation();
  const markdown = mode === 'markdown';
  const caption = (action: MarkupAction) => t(`queue.form.markup.${action}`);
  return (
    <Toolbar aria-label={t('queue.form.markupToolbar')}>
      <ToolbarToggleGroup
        type="single"
        aria-label={t('queue.form.markupMode')}
        value={mode}
        onValueChange={onMode}
      >
        <ToolbarToggleItem value="plain">{t('queue.form.modePlain')}</ToolbarToggleItem>
        <ToolbarToggleItem value="markdown">{t('queue.form.modeMarkdown')}</ToolbarToggleItem>
      </ToolbarToggleGroup>
      <ToolbarSeparator />
      {ACTIONS.map(({ action, icon: Icon, separated }) => (
        <span key={action} className="contents">
          {separated ? <ToolbarSeparator /> : null}
          <ToolbarButton
            aria-label={caption(action)}
            title={
              markdown ? caption(action) : t('queue.form.markupNeedsMd', { label: caption(action) })
            }
            disabled={!editing}
            onClick={() => onMark(action)}
          >
            <Icon aria-hidden />
          </ToolbarButton>
        </span>
      ))}
      <ToolbarButton
        className={cn('ml-auto w-auto px-2', preview && 'bg-accent text-foreground')}
        aria-pressed={preview}
        title={
          markdown
            ? t('queue.form.preview')
            : t('queue.form.markupNeedsMd', { label: t('queue.form.preview') })
        }
        disabled={!markdown}
        onClick={onPreview}
      >
        <Eye aria-hidden />
        {t('queue.form.preview')}
      </ToolbarButton>
    </Toolbar>
  );
}
