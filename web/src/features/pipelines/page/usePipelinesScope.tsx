import { useMemo, useState, type ReactNode, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import { useAllProjectsConfig } from '../../../shared/api/catalog/useAllProjectsConfig.ts';
import { enabledProjects } from '../../../shared/lib/catalog/projectRows.ts';
import type { PipelineSection } from '../../../shared/lib/nav/route.ts';
import { RepositoryPicker, type ProjectsMode } from '../../repositories/index.ts';
import { usePipelineNavigation } from './usePipelineNavigation.ts';
import { useMergedData } from './useMergedData.ts';
import { usePipelinesData } from './usePipelinesData.ts';

type Select = (
  id: string | null,
  section?: PipelineSection | null,
  variant?: string | null,
  project?: string | null,
) => void;

/**
 * What the page reads in the mode «All projects»: the lists group the projects and only show
 * them, while «Topology» and «System stages» show the one project chosen above them. Outside the mode the page reads its own project.
 */
export function usePipelinesScope(props: {
  api: Api;
  projects: ProjectsMode | undefined;
  section: PipelineSection | null;
  selected: string | null;
  dirty: RefObject<boolean>;
  onSelect: Select;
}) {
  const { api, projects, section, selected, dirty, onSelect } = props;
  const { t } = useTranslation();
  const mode = projects !== undefined;
  const picks = mode && (section === 'system' || section === 'topology');
  const listMode = mode && !picks;
  const list = useMemo(() => enabledProjects(projects?.registry ?? []), [projects?.registry]);
  const [picked, setPicked] = useState<string | null>(null);
  const tabPath = picks ? (picked ?? list[0]?.path ?? null) : null;
  const tabApi = useMemo(
    () => (tabPath === null ? api : api.forRepository(tabPath)),
    [api, tabPath],
  );
  const single = usePipelinesData(tabApi);
  const all = useAllProjectsConfig(api, list, listMode);
  const data = useMergedData(single, all, listMode);
  const choose = (id: string | null, next?: PipelineSection | null, variant?: string | null) =>
    onSelect(id, next, variant, null);
  const picker: ReactNode = picks ? (
    <div className="flex max-w-sm flex-col gap-1 px-4 pt-3">
      <RepositoryPicker
        label={t('projectOverview.project')}
        repositories={list.map((project) => project.path)}
        value={tabPath ?? ''}
        waiting={new Map()}
        onChange={setPicked}
      />
    </div>
  ) : null;
  const navigation = usePipelineNavigation({
    selected,
    section,
    dirty,
    onSelect: choose,
  });
  return { listMode, picker, tabApi, data, choose, navigation };
}
