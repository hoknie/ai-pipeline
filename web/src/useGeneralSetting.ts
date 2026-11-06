import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from './api.ts';
import type { ConfigEditorResponse } from './types.ts';

type Source = Pick<ConfigEditorResponse, 'settings' | 'settingsFiles'>;

export interface Setting<T extends boolean | string> {
  /** The configuration is read and the setting is known. */
  ready: boolean;
  /** `null`: the value is not of the expected kind. */
  value: T | null;
  /** The project file sets the value. */
  overridden: boolean;
  /** The file a write goes to: the one the value comes from. */
  level: 'global' | 'project';
  /** Path of that file, once the configuration is read. */
  file: string | null;
  busy: boolean;
  failure: string | null;
  set: (value: T) => Promise<void>;
}

export type GeneralSetting = Omit<Setting<boolean>, 'value'> & { value: boolean };

/**
 * A setting of the merged configuration. A write goes to the file the value comes from: the
 * project `settings.yaml` when it sets the value, otherwise the global one. With `source` the values come from the caller (who then reads them again in
 * `onChanged`); without it the hook reads the configuration itself.
 */
export function useSetting<T extends boolean | string>(
  api: Api | undefined,
  path: string,
  kind: 'boolean' | 'string',
  source?: Source,
  onChanged?: () => Promise<void> | void,
  /** Writes to this level instead of the one the value comes from. */
  writeLevel?: 'global' | 'project',
): Setting<T> {
  const { t } = useTranslation();
  const [read, setRead] = useState<Source | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!api) return;
    setRead(await api.config());
  }, [api]);

  useEffect(() => {
    if (source) return;
    load().catch((error: Error) => setFailure(error.message));
  }, [source, load]);

  const view = source ?? read;
  const setting = view?.settings.find((candidate) => candidate.path === path);
  const files = view?.settingsFiles;
  const raw: unknown = setting?.value;
  const overridden =
    setting !== undefined && files !== undefined && setting.file === files.project.file;
  const level = writeLevel ?? (overridden ? 'project' : 'global');

  const set = async (value: T) => {
    if (!api || !files) return;
    setBusy(true);
    setFailure(null);
    try {
      const result = await api.writeSetting(path, value, files[level].revision, level);
      if (!result.ok) {
        setFailure(
          result.reason === 'conflict'
            ? t('settings.writeConflict', { message: result.message })
            : result.errors.map((error) => `${error.path}: ${error.message}`).join('; '),
        );
      }
      await (onChanged ? onChanged() : load());
    } catch (error) {
      setFailure((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return {
    ready: setting !== undefined && files !== undefined,
    value: typeof raw === kind ? (raw as T) : null,
    overridden,
    level,
    file: files ? files[level].file : null,
    busy,
    failure,
    set,
  };
}

/** A boolean setting; a missing or foreign value reads as false. */
export function useGeneralSetting(
  api: Api | undefined,
  path: string,
  source?: Source,
  onChanged?: () => Promise<void> | void,
  writeLevel?: 'global' | 'project',
): GeneralSetting {
  const setting = useSetting<boolean>(api, path, 'boolean', source, onChanged, writeLevel);
  return { ...setting, value: setting.value === true };
}
