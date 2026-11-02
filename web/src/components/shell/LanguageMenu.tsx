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
export function LanguageMenu({ compact = false }: { compact?: boolean }) {
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
        className={cn(navRowClass(), compact && 'w-8 justify-center px-0')}
        aria-label={label}
      >
        <Languages />
        {compact ? null : <span className="truncate">{label}</span>}
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
