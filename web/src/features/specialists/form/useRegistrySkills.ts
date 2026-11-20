import { useEffect, useState } from 'react';

import type { Api } from '../../../shared/api/api.ts';
import type { PickerOption } from '../../../shared/ui/forms/ValuesPicker.tsx';

/**
 * The skills of the registry of the project as hints `registry:<name>` with the latest version.
 * A registry that is not connected or does not answer gives no hints: the field still takes text.
 */
export function useRegistrySkills(api: Api | undefined): PickerOption[] {
  const [options, setOptions] = useState<PickerOption[]>([]);
  useEffect(() => {
    if (!api) return undefined;
    let current = true;
    api
      .registrySkills()
      .then((skills) => {
        if (!current) return;
        setOptions(
          skills.map((skill) => ({
            name: `registry:${skill.name}`,
            source: 'other' as const,
            description: [skill.versions[0] ? `latest ${skill.versions[0]}` : '', skill.title]
              .filter((part) => part !== '' && part !== skill.name)
              .join(' · '),
          })),
        );
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [api]);
  return options;
}
