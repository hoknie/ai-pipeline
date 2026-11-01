import { Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { LANGUAGES, useLanguage, type LanguageChoice } from '../../i18n/index.ts';
import { cn } from '../../lib/cn.ts';
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

/** Choice of the language: «as in the browser» or one of the languages, named in itself. */
export function LanguageMenu({ collapsed = false }: { collapsed?: boolean }) {
  const { t } = useTranslation();
  const { choice, setChoice } = useLanguage();
  const current =
    choice === 'system'
      ? t('language.system')
      : (LANGUAGES.find((entry) => entry.code === choice)?.name ?? choice);
  const label = t('language.label', { language: current });
  const trigger = (
    <DropdownMenuTrigger asChild>
      <Button
        variant="ghost"
        data-nav-row
        className={cn(navRowClass(collapsed))}
        aria-label={label}
      >
        <Languages />
        {collapsed ? null : <span className="truncate">{label}</span>}
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
        <DropdownMenuRadioGroup
          value={choice}
          onValueChange={(value) => setChoice(value as LanguageChoice)}
        >
          <DropdownMenuRadioItem value="system">{t('language.system')}</DropdownMenuRadioItem>
          {LANGUAGES.map((entry) => (
            <DropdownMenuRadioItem key={entry.code} value={entry.code} lang={entry.locale}>
              {entry.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
