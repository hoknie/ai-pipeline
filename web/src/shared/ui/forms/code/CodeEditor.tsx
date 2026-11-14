import { useState } from 'react';
import type { ComponentProps } from 'react';

import { cn } from '../../../lib/browser/cn.ts';
import { tokenizeShell } from '../../../lib/browser/shellTokens.ts';
import type { ShellTokenKind } from '../../../lib/browser/shellTokens.ts';

const KIND_CLASS: Record<ShellTokenKind, string> = {
  plain: '',
  comment: 'text-muted-foreground italic',
  string: 'text-emerald-600 dark:text-emerald-400',
  variable: 'text-sky-600 dark:text-sky-400',
  flag: 'text-amber-600 dark:text-amber-400',
  operator: 'text-fuchsia-600 dark:text-fuchsia-400',
};

const TEXT = 'font-mono text-sm leading-5 whitespace-pre';

type Props = Omit<ComponentProps<'textarea'>, 'value' | 'onChange'> & {
  value: string;
  onChange: ComponentProps<'textarea'>['onChange'];
};

/** A textarea for shell text: line numbers on the left, syntax highlighting under the text. */
export function CodeEditor({ className, value, rows = 12, style, ...props }: Props) {
  const [scroll, setScroll] = useState({ top: 0, left: 0 });
  const lines = value.split('\n').length;
  const move = { transform: `translate(${-scroll.left}px, ${-scroll.top}px)` };
  return (
    <div
      className={cn(
        'flex overflow-hidden rounded-md border border-input bg-card has-[textarea:disabled]:opacity-50',
        className,
      )}
      data-testid="code-editor"
    >
      <div
        aria-hidden
        className="w-10 shrink-0 select-none overflow-hidden border-r border-input bg-muted/40 py-1.5 pr-2 text-right text-muted-foreground"
        data-testid="code-editor-gutter"
      >
        <div className={TEXT} style={move}>
          {Array.from({ length: lines }, (_, index) => index + 1).join('\n')}
        </div>
      </div>
      <div className="relative min-w-0 flex-1">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-hidden px-2.5 py-1.5"
        >
          <div className={TEXT} style={move} data-testid="code-editor-highlight">
            {tokenizeShell(value).map((token, index) => (
              <span key={index} className={KIND_CLASS[token.kind]}>
                {token.text}
              </span>
            ))}
            {'\n'}
          </div>
        </div>
        <textarea
          wrap="off"
          rows={rows}
          value={value}
          style={{ minHeight: '16rem', ...style }}
          className={cn(
            TEXT,
            'relative block h-full w-full resize-y overflow-auto bg-transparent px-2.5 py-1.5 text-transparent caret-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed aria-invalid:border-destructive',
          )}
          onScroll={(event) =>
            setScroll({ top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft })
          }
          {...props}
        />
      </div>
    </div>
  );
}
