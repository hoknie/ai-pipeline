import { toast } from 'sonner';

export function notifySuccess(text: string): void {
  toast.success(text, { duration: 4000 });
}

/** Errors stay until the person closes them. */
export function notifyError(error: unknown): void {
  toast.error(error instanceof Error ? error.message : String(error), { duration: Infinity });
}
