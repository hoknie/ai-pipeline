import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import type { EditorChain, FieldError, WriteLevel } from '../../../shared/api/types.ts';
import { useConfirm } from '../../../shared/ui/overlays/confirm.tsx';
import {
  defaultChainDraft,
  defaultRuntimeItem,
  draftOfChain,
  sameChainDraft,
  valueOfChain,
} from './draft.ts';
import type { ChainDraft, ChainRuntimeDraft } from './types.ts';

export interface UseChainEditorArgs {
  api: Api;
  chain: EditorChain | null;
  scope?: 'global' | null;
  onDirty: (dirty: boolean) => void;
  onSaved: (slug: string) => Promise<void>;
  onDeleted: () => Promise<void>;
}

interface SaveContext {
  api: Api;
  draft: ChainDraft;
  chain: EditorChain | null;
  level: WriteLevel;
  onSaved: (slug: string) => Promise<void>;
  setBusy: (busy: boolean) => void;
  setProblem: (problem: string | null) => void;
  setConflict: (conflict: string | null) => void;
  setErrors: (errors: FieldError[]) => void;
  setReferences: (references: string[]) => void;
}

async function executeSave(ctx: SaveContext): Promise<void> {
  const { api, draft, chain, level, onSaved } = ctx;
  if (!draft.slug.trim()) return;
  ctx.setBusy(true);
  ctx.setProblem(null);
  ctx.setConflict(null);
  ctx.setErrors([]);
  ctx.setReferences([]);
  try {
    const revision = chain?.sources[level]?.revision ?? null;
    const res = await api.writeChain(
      draft.slug.trim(),
      valueOfChain(draft, chain?.sources[level]?.raw ?? chain?.raw),
      revision,
      level,
    );
    if (res.ok) {
      await onSaved(draft.slug.trim());
    } else if (res.reason === 'conflict') {
      ctx.setConflict(res.message);
    } else {
      const refs =
        res.references?.map((r) => r.specialist ?? r.pipeline ?? '').filter(Boolean) ?? [];
      if (refs.length > 0) ctx.setReferences(refs);
      ctx.setErrors(res.errors ?? []);
    }
  } catch (e) {
    ctx.setProblem((e as Error).message);
  } finally {
    ctx.setBusy(false);
  }
}

interface DeleteContext {
  api: Api;
  chain: EditorChain | null;
  level: WriteLevel;
  onDeleted: () => Promise<void>;
  setBusy: (busy: boolean) => void;
  setProblem: (problem: string | null) => void;
  setConflict: (conflict: string | null) => void;
  setErrors: (errors: FieldError[]) => void;
  setReferences: (references: string[]) => void;
}

async function executeDelete(ctx: DeleteContext): Promise<void> {
  const { api, chain, level, onDeleted } = ctx;
  const source = chain?.sources[level];
  if (!chain || !source) return;
  ctx.setBusy(true);
  ctx.setProblem(null);
  try {
    const res = await api.deleteChain(chain.slug, source.revision, level);
    if (res.ok) {
      await onDeleted();
    } else if (res.reason === 'conflict') {
      ctx.setConflict(res.message);
    } else {
      const refs =
        res.references?.map((r) => r.specialist ?? r.pipeline ?? '').filter(Boolean) ?? [];
      if (refs.length > 0) ctx.setReferences(refs);
      ctx.setErrors(res.errors ?? []);
    }
  } catch (e) {
    ctx.setProblem((e as Error).message);
  } finally {
    ctx.setBusy(false);
  }
}

function useChainItems(setDraft: (updater: (cur: ChainDraft) => ChainDraft) => void) {
  const updateItem = (index: number, item: ChainRuntimeDraft) => {
    setDraft((cur) => {
      const runtimes = [...cur.runtimes];
      runtimes[index] = item;
      return { ...cur, runtimes };
    });
  };
  const moveItem = (from: number, to: number) => {
    setDraft((cur) => {
      const runtimes = [...cur.runtimes];
      const [moved] = runtimes.splice(from, 1);
      if (moved) runtimes.splice(to, 0, moved);
      return { ...cur, runtimes };
    });
  };
  const removeItem = (index: number) => {
    setDraft((cur) => ({ ...cur, runtimes: cur.runtimes.filter((_, i) => i !== index) }));
  };
  const addItem = () => {
    setDraft((cur) => ({ ...cur, runtimes: [...cur.runtimes, defaultRuntimeItem()] }));
  };
  return { updateItem, moveItem, removeItem, addItem };
}

function useChainRemove(ctx: DeleteContext, readOnly: boolean) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const { chain, level } = ctx;
  const removeLabel =
    level === 'project' && chain?.sources.global
      ? t('settings.editor.removeOverride')
      : t('chains.delete');
  const remove = async () => {
    const source = chain?.sources[level];
    if (!chain || !source || readOnly) return;
    const ok = await confirm({
      title: t('settings.editor.removeTitle', { action: removeLabel, id: chain.slug }),
      description: t('settings.editor.removeDescription', { file: source.file }),
      confirmLabel: removeLabel,
      cancelLabel: t('settings.editor.stay'),
      destructive: true,
    });
    if (ok) await executeDelete(ctx);
  };
  return { removeLabel, remove };
}

export function useChainEditor({
  api,
  chain,
  scope,
  onDirty,
  onSaved,
  onDeleted,
}: UseChainEditorArgs) {
  const level: WriteLevel = scope ?? 'project';
  const initial = useMemo(
    () =>
      chain
        ? draftOfChain({ ...chain, raw: chain.sources[level]?.raw ?? chain.raw })
        : defaultChainDraft(),
    [chain, level],
  );
  const [draft, setDraft] = useState<ChainDraft>(initial);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [conflict, setConflict] = useState<string | null>(null);
  const [references, setReferences] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    setDraft(initial);
    setErrors([]);
    setConflict(null);
    setReferences([]);
    setProblem(null);
  }, [initial]);

  const readOnly = chain?.level === 'global' && scope !== 'global';
  const canOverride = Boolean(chain?.sources.global && !chain.sources.project && !scope);
  const dirty = !sameChainDraft(draft, initial);
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);

  const feedback = { setBusy, setProblem, setConflict, setErrors, setReferences };
  const write = () => executeSave({ api, draft, chain, level, onSaved, ...feedback });
  const save = () => (readOnly ? Promise.resolve() : write());
  const override = () => (canOverride ? write() : Promise.resolve());
  const deletion = useChainRemove({ api, chain, level, onDeleted, ...feedback }, readOnly);
  const items = useChainItems(setDraft);
  const reset = () => {
    setDraft(initial);
    setErrors([]);
    setConflict(null);
    setReferences([]);
    setProblem(null);
  };

  return {
    draft,
    setDraft,
    level,
    readOnly,
    canOverride,
    override,
    dirty,
    busy,
    errors,
    conflict,
    references,
    problem,
    save,
    reset,
    ...items,
    ...deletion,
  };
}
