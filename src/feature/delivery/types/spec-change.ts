/** An OpenSpec change a group made or is making. */
export interface SpecCandidate {
  change: string;
  path: string;
}

/** The documents of the OpenSpec change of a group. */
export interface GroupSpecView {
  /** The directory name of the change, for example `add-export`. */
  change: string;
  /** The directory of the change from the repository root. */
  path: string;
  design: string | null;
  tasks: string | null;
}

const SPEC_PATH = /^openspec\/changes\/(archive\/[^/]+|[^/]+)\/(?:proposal|design|tasks)\.md$/;

/** The changes among `paths`, active before archived and then by name. */
export function pickSpecChange(paths: string[]): SpecCandidate[] {
  const found = new Map<string, SpecCandidate>();
  for (const path of paths) {
    const directory = SPEC_PATH.exec(path)?.[1];
    if (directory === undefined || found.has(directory)) continue;
    found.set(directory, {
      change: directory.slice(directory.lastIndexOf('/') + 1),
      path: `openspec/changes/${directory}`,
    });
  }
  const archived = (candidate: SpecCandidate) => candidate.path.includes('/changes/archive/');
  return [...found.values()].sort(
    (a, b) =>
      Number(archived(a)) - Number(archived(b)) ||
      (a.change < b.change ? -1 : a.change > b.change ? 1 : 0),
  );
}
