import { useTranslation } from 'react-i18next';

import { cn } from '../../../shared/lib/browser/cn.ts';
import { ProjectDot } from '../../../shared/ui/feedback/ProjectDot.tsx';
import { PROJECT_COLOR_NAMES } from './projectDraft.ts';

/** The color of a project: the palette of tags and «No color», as a group of radio buttons. */
export function ColorField({
  id,
  value,
  onChange,
  invalid = false,
}: {
  id: string;
  value: string | null;
  onChange: (color: string | null) => void;
  invalid?: boolean;
}) {
  const { t } = useTranslation();
  const option = (color: (typeof PROJECT_COLOR_NAMES)[number] | null) => {
    const checked = color === value;
    const label = color === null ? t('projects.noColor') : t(`projects.colors.${color}`);
    return (
      <button
        key={color ?? 'none'}
        type="button"
        role="radio"
        aria-checked={checked}
        aria-label={label}
        title={label}
        data-color={color ?? 'none'}
        onClick={() => onChange(color)}
        className={cn(
          'flex size-7 items-center justify-center rounded-md border',
          checked ? 'border-foreground' : 'border-transparent hover:border-border',
        )}
      >
        {color === null ? (
          <span aria-hidden className="text-xs text-muted-foreground">
            —
          </span>
        ) : (
          <ProjectDot color={color} className="size-3" />
        )}
      </button>
    );
  };
  return (
    <div
      id={id}
      role="radiogroup"
      aria-label={t('projects.fields.color')}
      aria-invalid={invalid}
      className="flex flex-wrap gap-1"
    >
      {option(null)}
      {PROJECT_COLOR_NAMES.map((color) => option(color))}
    </div>
  );
}
