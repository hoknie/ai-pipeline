import { useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../api.ts';
import type { QueueView } from '../types.ts';

import { Button } from '../ui/button.tsx';
import { Input } from '../ui/input.tsx';
import { Label } from '../ui/label.tsx';

export const PARALLEL_MAX = 20;

/** The number in the field, or null when it is not an integer from 1 to 20. */
export function parseParallel(text: string): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const value = Number(text);
  return value >= 1 && value <= PARALLEL_MAX ? value : null;
}

/**
 * Parallelism of the queue: the buttons save every press. The shown value changes at once,
 * at most one request is in flight and the last value is the one that stays on the server.
 */
export function ParallelStepper({
  api,
  queue,
  text,
  onText,
  onQueue,
  onError,
}: {
  api: Api;
  queue: QueueView;
  /** What is typed in the field; null while it is not edited. */
  text: string | null;
  onText: (text: string | null) => void;
  onQueue: (queue: QueueView) => void;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const [local, setLocal] = useState<number | null>(null);
  const flight = useRef(false);
  const wanted = useRef(queue.parallel);
  const server = useRef(queue.parallel);
  server.current = queue.parallel;

  const shown = local ?? queue.parallel;
  const fieldText = text ?? String(shown);
  const invalid = parseParallel(fieldText) === null;

  const push = async () => {
    if (flight.current) return;
    flight.current = true;
    try {
      let sent: number;
      let view: QueueView;
      do {
        sent = wanted.current;
        view = await api.queueSettings({ parallel: sent });
      } while (wanted.current !== sent);
      onQueue(view);
      setLocal(null);
    } catch (error) {
      wanted.current = server.current;
      setLocal(null);
      onError((error as Error).message);
    } finally {
      flight.current = false;
    }
  };

  const change = (value: number) => {
    if (value === shown && local === null) return;
    wanted.current = value;
    setLocal(value);
    void push();
  };

  const commit = () => {
    const parsed = parseParallel(fieldText);
    if (parsed === null) return;
    onText(null);
    if (parsed !== shown) change(parsed);
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <Label htmlFor="queue-parallel">{t('queue.parallel')}</Label>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={t('queue.parallelDecrease')}
          disabled={shown <= 1}
          onClick={() => change(shown - 1)}
        >
          <Minus aria-hidden />
        </Button>
        <Input
          id="queue-parallel"
          type="text"
          inputMode="numeric"
          className="w-16 text-center"
          value={fieldText}
          aria-invalid={invalid}
          onChange={(event) => onText(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit();
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={t('queue.parallelIncrease')}
          disabled={shown >= PARALLEL_MAX}
          onClick={() => change(shown + 1)}
        >
          <Plus aria-hidden />
        </Button>
      </div>
      {invalid ? (
        <span className="text-sm text-destructive">
          {t('queue.parallelRange', { max: PARALLEL_MAX })}
        </span>
      ) : null}
    </>
  );
}
