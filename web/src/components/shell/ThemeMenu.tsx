import { Monitor, Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../lib/cn.ts';
import { useTheme, type Theme } from '../../theme.ts';
import { Button } from '../../ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu.tsx';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../ui/tooltip.tsx';

import { navRowClass } from './navRow.ts';

const THEMES: Theme[] = ['system', 'light', 'dark'];

export function ThemeMenu({ collapsed = false }: { collapsed?: boolean }) {
  const { t } = useTranslation();
  const { theme, resolved, setTheme } = useTheme();
  const label = t('theme.label', { theme: t(`theme.${theme}`) });
  const Icon = theme === 'system' ? Monitor : resolved === 'dark' ? Moon : Sun;
  const trigger = (
    <DropdownMenuTrigger asChild>
      <Button
        variant="ghost"
        data-nav-row
        className={cn(navRowClass(collapsed))}
        aria-label={label}
      >
        <Icon />
        {collapsed ? null : <span>{label}</span>}
      </Button>
    </DropdownMenuTrigger>
  );
  return (
    <DropdownMenu>
      {collapsed ? (
        <Tooltip>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent side="right">{label}</TooltipContent>
        </Tooltip>
      ) : (
        trigger
      )}
      <DropdownMenuContent align="start" side="top">
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
