import { useEffect, useRef, useState } from 'react';
import type { Api } from '../../../../shared/api/api.ts';
import type { DeliveryBranch } from '../../../../shared/api/types.ts';

/** The branch name rules of git check-ref-format --branch. */
export function validBranchName(name: string): boolean {
  return (
    name.length > 0 &&
    name !== '@' &&
    name.length <= 256 &&
    !name.startsWith('-') &&
    !name.startsWith('/') &&
    !name.endsWith('/') &&
    !name.endsWith('.') &&
    !name.includes('..') &&
    !name.includes('@{') &&
    !/[\x00-\x20\x7f~^:?*\\\[]/.test(name) &&
    name.split('/').every((part) => part !== '' && !part.startsWith('.') && !part.endsWith('.lock'))
  );
}

/** A result belongs to the exact selection and project set that produced it. */
export function useBranchValidation(
  api: Api | undefined,
  projects: readonly string[],
  branch: DeliveryBranch | null | undefined,
): 'valid' | 'pending' | 'invalid' {
  const key = JSON.stringify([projects, branch]);
  const generation = useRef({ key, value: 0 });
  if (generation.current.key !== key)
    generation.current = { key, value: generation.current.value + 1 };
  const epoch = generation.current.value;
  const [result, setResult] = useState<{ epoch: number; valid: boolean } | null>(null);
  useEffect(() => {
    if (!branch || !api || projects.length === 0 || !validBranchName(branch.name)) return;
    let current = true;
    Promise.all(projects.map((project) => api.forRepository(project).branches(branch.name, true)))
      .then((answers) => {
        if (current)
          setResult({
            epoch,
            valid: answers.every(
              (names) => (branch.strategy === 'existing') === names.includes(branch.name),
            ),
          });
      })
      .catch(() => {
        if (current) setResult({ epoch, valid: false });
      });
    return () => {
      current = false;
    };
  }, [api, key, epoch]);
  if (!branch) return 'valid';
  if (!api || projects.length === 0 || !validBranchName(branch.name)) return 'invalid';
  return result?.epoch === epoch ? (result.valid ? 'valid' : 'invalid') : 'pending';
}
