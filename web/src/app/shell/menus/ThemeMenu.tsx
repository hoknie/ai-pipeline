import { Monitor, Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../../shared/lib/browser/cn.ts';
import { useTheme, type Theme } from '../../../shared/lib/browser/theme.ts';
import { Button } from '../../../shared/ui/forms/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../../../shared/ui/overlays/dropdown-menu.tsx';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../shared/ui/feedback/tooltip.tsx';

import { navRowClass } from '../nav/navRow.ts';

const THEMES: Theme[] = ['system', 'light', 'dark'];

export function ThemeMenu({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const { theme, resolved, setTheme } = useTheme();
  const label = t('theme.label', { theme: t(`theme.${theme}`) });
  const Icon = theme === 'system' ? Monitor : resolved === 'dark' ? Moon : Sun;
  const trigger = (
    <DropdownMenuTrigger asChild>
      <Button
        variant="ghost"
        data-nav-row
        className={cn(navRowClass(), compact && 'w-8 justify-center px-0')}
        aria-label={label}
      >
        <Icon />
        {compact ? null : <span>{label}</span>}
      </Button>
    </DropdownMenuTrigger>
  );
  return (
    <DropdownMenu>
      {compact ? (
        <Tooltip>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent side="bottom">{label}</TooltipContent>
        </Tooltip>
      ) : (
        trigger
      )}
      <DropdownMenuContent align={compact ? 'end' : 'start'} side={compact ? 'bottom' : 'top'}>
        <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as Theme)}>
          {THEMES.map((key) => (
            <DropdownMenuRadioItem key={key} value={key}>
              {t(`theme.${key}`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
