import { repositoryColor, repositoryLabel } from '../../../shared/lib/catalog/repositories.ts';

/** The project a task or a run of the global queue belongs to. */
export function ProjectLabel({ repository }: { repository: string }) {
  const color = repositoryColor(repository);
  return (
    <span
      data-project={repository}
      title={repository}
      className="inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
    >
      {color ? (
        <span
          aria-hidden="true"
          className="size-2 rounded-full"
          style={{ backgroundColor: color }}
        />
      ) : null}
      {repositoryLabel(repository)}
    </span>
  );
}
