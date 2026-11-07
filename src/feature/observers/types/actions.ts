/** What an observer does on its own run: the same as a person would. */
export type RepairAction =
  | { action: 'answer'; token: string; group: string; answer: string }
  | { action: 'retry'; token: string; group: string; refreshConfig?: boolean | undefined }
  | { action: 'cancel'; token: string; group?: string | undefined; reason: string };
