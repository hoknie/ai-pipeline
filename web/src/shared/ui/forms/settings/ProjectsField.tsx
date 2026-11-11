import { useTranslation } from 'react-i18next';

import type { RepositoryView } from '../../../api/types.ts';
import { ProjectDot } from '../../feedback/ProjectDot.tsx';
import { ValuesPicker, type PickerOption } from '../ValuesPicker.tsx';

/**
 * A choice of projects of the registry (`stats.exclude`): the chip and the option show the color dot
 * and the name, the path is the tooltip. A path outside the registry stays in the list with a note and can be removed.
 */
export function ProjectsField({
  id,
  label,
  values,
  projects,
  disabled,
  invalid,
  onChange,
}: {
  id: string;
  label: string;
  values: string[];
  projects: readonly RepositoryView[];
  disabled: boolean;
  invalid: boolean;
  onChange: (values: string[]) => void;
}) {
  const { t } = useTranslation();
  const byPath = new Map(projects.map((project) => [project.path, project]));
  const options: PickerOption[] = projects.map((project) => ({
    name: project.path,
    source: 'project',
  }));
  const display = (path: string) => {
    const project = byPath.get(path);
    return project === undefined ? path : project.label;
  };
  return (
    <ValuesPicker
      id={id}
      label={label}
      values={values}
      onChange={onChange}
      options={options}
      display={display}
      icon={(path) => {
        const project = byPath.get(path);
        return project === undefined ? null : <ProjectDot color={project.color} />;
      }}
      hint={(path) => byPath.get(path)?.displayPath}
      mark={(path) => (byPath.has(path) ? null : t('settingsPage.notInRegistry'))}
      headings={{ project: '' }}
      creatable={false}
      disabled={disabled}
      invalid={invalid}
    />
  );
}
