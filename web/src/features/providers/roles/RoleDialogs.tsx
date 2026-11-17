import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import type { ConfigEditorResponse, ProvidersView } from '../../../shared/api/types.ts';
import { Alert } from '../../../shared/ui/feedback/alert.tsx';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { Input } from '../../../shared/ui/forms/input.tsx';
import { Label } from '../../../shared/ui/forms/label.tsx';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../shared/ui/overlays/dialog.tsx';
import { SLUG_PATTERN, slugOf } from '../form/slug.ts';
import { removeRole } from './edit.ts';
import { RemoveRoleDialog } from './RemoveRoleDialog.tsx';
import { holdersOf } from './removal.ts';
import type { useRoleActions } from './useRoleActions.ts';

/** A new role: a name and a slug taken from it until it is typed by hand. */
export function AddRoleDialog({
  taken,
  onAdd,
  onClose,
}: {
  taken: ReadonlySet<string>;
  onAdd: (slug: string, name: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [touched, setTouched] = useState(false);
  const problem = !SLUG_PATTERN.test(slug)
    ? t('providers.form.errors.slugFormat')
    : taken.has(slug)
      ? t('providers.roles.slugTaken')
      : null;
  const ready = name.trim() !== '' && problem === null;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('providers.roles.addTitle')}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (ready) onAdd(slug, name.trim());
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="role-name">{t('providers.roles.name')}</Label>
            <Input
              id="role-name"
              value={name}
              autoFocus
              onChange={(event) => {
                setName(event.target.value);
                if (!touched) setSlug(slugOf(event.target.value));
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="role-slug">{t('providers.roles.slug')}</Label>
            <Input
              id="role-slug"
              value={slug}
              aria-invalid={slug !== '' && problem !== null ? true : undefined}
              onChange={(event) => {
                setSlug(event.target.value);
                setTouched(true);
              }}
            />
            {slug !== '' && problem ? (
              <p role="alert" className="text-xs text-destructive">
                {problem}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={!ready}>
              {t('providers.roles.add')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A new name of a role; the slug does not change. */
export function RenameRoleDialog({
  slug,
  name,
  onRename,
  onClose,
}: {
  slug: string;
  name: string;
  onRename: (name: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(name);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('providers.roles.renameTitle', { slug })}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (value.trim() !== '') onRename(value.trim());
          }}
        >
          <Label htmlFor="role-new-name">{t('providers.roles.name')}</Label>
          <Input
            id="role-new-name"
            value={value}
            autoFocus
            onChange={(event) => setValue(event.target.value)}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={value.trim() === ''}>
              {t('providers.roles.rename')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RolesFailure({ message }: { message: string | null }) {
  if (!message) return null;
  return <Alert variant="destructive">{message}</Alert>;
}

/** The dialog that is open: a new role, a new name, or the removal of a role that has models. */
export function RoleDialogHost({
  api,
  editor,
  view,
  actions,
}: {
  api: Api;
  editor: ConfigEditorResponse | null;
  view: ProvidersView;
  actions: ReturnType<typeof useRoleActions>;
}) {
  const { dialog } = actions;
  const close = () => actions.setDialog(null);
  const target =
    dialog && dialog.kind !== 'add' ? view.roles.find((r) => r.slug === dialog.slug) : null;
  if (dialog?.kind === 'add') {
    return (
      <AddRoleDialog
        taken={new Set(view.roles.map((role) => role.slug))}
        onAdd={actions.add}
        onClose={close}
      />
    );
  }
  if (!target) return null;
  if (dialog?.kind === 'rename') {
    return (
      <RenameRoleDialog
        slug={target.slug}
        name={target.name}
        onRename={(name) => actions.rename(target.slug, name)}
        onClose={close}
      />
    );
  }
  if (!editor) return null;
  return (
    <RemoveRoleDialog
      api={api}
      editor={editor}
      role={target.slug}
      name={target.name}
      holders={holdersOf(view.providers, target.slug)}
      removeRole={() => actions.save(removeRole(actions.record, target.slug))}
      onDone={close}
      onClose={close}
    />
  );
}
