import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog.tsx';

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

type Confirm = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Confirm | null>(null);

/** Asks the question in one dialog; focus starts on the refusal and Esc refuses. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((answer: boolean) => void) | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const confirm = useCallback<Confirm>((next) => {
    resolver.current?.(false);
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setOptions(next);
    });
  }, []);
  const settle = (answer: boolean) => {
    resolver.current?.(answer);
    resolver.current = null;
    setOptions(null);
  };
  return (
    <ConfirmContext value={confirm}>
      {children}
      <AlertDialog open={options !== null} onOpenChange={(open) => !open && settle(false)}>
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            opener.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{options?.title}</AlertDialogTitle>
            {options?.description ? (
              <AlertDialogDescription>{options.description}</AlertDialogDescription>
            ) : (
              <AlertDialogDescription className="sr-only">{options?.title}</AlertDialogDescription>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{options?.cancelLabel ?? t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction destructive={options?.destructive} onClick={() => settle(true)}>
              {options?.confirmLabel ?? t('common.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext>
  );
}

export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('useConfirm needs a ConfirmProvider');
  return confirm;
}
