import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Api } from '../../../../shared/api/api.ts';
import { Input } from '../../../../shared/ui/forms/input.tsx';
import { Button } from '../../../../shared/ui/forms/button.tsx';
import { Label } from '../../../../shared/ui/forms/label.tsx';
import type { FormState } from '../TaskFields.tsx';
import { validBranchName } from './useBranchValidation.ts';

function useBranchSearch(api: Api | undefined, repository: string | null, query: string) {
  const [results, setResults] = useState<string[]>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    setResults([]);
    setError(false);
    if (!api || !repository) return;
    const timer = setTimeout(() => {
      api
        .forRepository(repository)
        .branches(query)
        .then((names) => {
          if (active) setResults(names);
        })
        .catch(() => {
          if (active) setError(true);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [api, repository, query]);
  return { results, error };
}

export function BranchField({
  state,
  api,
  repository,
  validation,
}: {
  state: FormState;
  api: Api | undefined;
  repository: string | null;
  validation: 'valid' | 'pending' | 'invalid';
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState(state.effective.deliveryBranch?.name ?? '');
  const { results, error } = useBranchSearch(api, repository, query);
  const chosen = state.effective.deliveryBranch;
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={`${state.idPrefix}-delivery-branch`}>{t('queue.form.deliveryBranch')}</Label>
      <Input
        id={`${state.idPrefix}-delivery-branch`}
        value={query}
        maxLength={256}
        onChange={(event) => {
          setQuery(event.target.value);
          if (chosen) state.change({ deliveryBranch: null });
        }}
      />
      {results.map((name) => (
        <Button
          key={name}
          variant="outline"
          size="sm"
          onClick={() => {
            setQuery(name);
            state.change({ deliveryBranch: { name, strategy: 'existing' } });
          }}
        >
          {name}
        </Button>
      ))}
      <Button
        variant="outline"
        size="sm"
        disabled={!validBranchName(query)}
        onClick={() => state.change({ deliveryBranch: { name: query, strategy: 'create' } })}
      >
        {t('queue.form.branchCreate')}
      </Button>
      {chosen ? (
        <p className="text-xs">
          {t('queue.form.branchSelected', {
            name: chosen.name,
            strategy: t(`queue.form.branchStrategy.${chosen.strategy}`),
          })}{' '}
          <button
            type="button"
            onClick={() => {
              state.change({ deliveryBranch: null });
              setQuery('');
            }}
          >
            {t('queue.form.branchReset')}
          </button>
        </p>
      ) : null}
      {chosen && validation !== 'valid' ? (
        <p role="status" className="text-xs text-muted-foreground">
          {t(validation === 'pending' ? 'queue.form.branchChecking' : 'queue.form.branchInvalid')}
        </p>
      ) : null}
      {error ? <p role="alert">{t('queue.form.branchSearchError')}</p> : null}
    </div>
  );
}
