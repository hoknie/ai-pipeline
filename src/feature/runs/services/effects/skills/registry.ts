import { appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { missingSkills } from '../../../../agents/services/index.ts';
import type { Runtime } from '../../../../agents/types/index.ts';
import {
  isRegistrySkill,
  parseRegistrySkill,
  type Specialist,
} from '../../../../swarm-config/types/index.ts';
import type { Event } from '../../../machine/index.ts';
import type {
  RegistrySkillsPinned,
  RegistrySkillPin,
  RegistrySkillsPort,
} from '../../../ports/index.ts';
import type { RunState } from '../../../types/index.ts';

/** What an attempt gets of the registry skills of its specialist. */
export interface AttemptSkills {
  /** The folder with `.claude/skills/<name>` to hand to the runtime; null: none. */
  directory: string | null;
  /** Warnings for the log of the step. */
  warnings: string[];
  /** Whether the folder holds the skill with the lessons of earlier runs; absent: it does not. */
  lessons?: boolean;
}

export const NO_SKILLS: AttemptSkills = { directory: null, warnings: [] };

/** The names of the `registry:` skills of a specialist, in order, without repeats. */
export function registrySkillNames(specialist: Specialist): { name: string; text: string }[] {
  const found: { name: string; text: string }[] = [];
  for (const text of specialist.skills) {
    if (!isRegistrySkill(text)) continue;
    const parsed = parseRegistrySkill(text);
    if (parsed.ok && !found.some((one) => one.name === parsed.ref.name)) {
      found.push({ name: parsed.ref.name, text });
    }
  }
  return found;
}

/** What an attempt does about the registry skills of its specialist. */
export type SkillsPlan =
  | { kind: 'none' }
  | { kind: 'unsupported'; warnings: string[] }
  | { kind: 'registry'; wanted: { name: string; text: string }[]; missing: string[] };

/** Decides what the attempt needs: nothing, a warning, or versions to fix and lay out. */
export function planSkills(
  state: RunState,
  specialist: Specialist,
  runtime: Pick<Runtime, 'name' | 'loadsExtraSkills'>,
): SkillsPlan {
  const wanted = registrySkillNames(specialist);
  if (wanted.length === 0) return { kind: 'none' };
  if (!runtime.loadsExtraSkills) {
    return {
      kind: 'unsupported',
      warnings: [
        `registry skills are not supported by runtime ${runtime.name}: ${wanted.map((one) => one.name).join(', ')}`,
      ],
    };
  }
  const fixed = state.run.pinnedSkills ?? {};
  const missing = wanted.filter((one) => !Object.hasOwn(fixed, one.name)).map((one) => one.text);
  return { kind: 'registry', wanted, missing };
}

/** The event that fixes the versions a registry answered with; null when it fixed none. */
export function pinsEvent(result: RegistrySkillsPinned): Event | null {
  if (result.pinned.length === 0) return null;
  const pins = Object.fromEntries(
    result.pinned.map((pin) => [pin.name, { version: pin.version, connection: pin.connection }]),
  );
  return { kind: 'skills_pinned', pins };
}

/** The pins the run holds for the wanted skills: the first fixation wins over a parallel one. */
export function heldPins(state: RunState, wanted: { name: string }[]): RegistrySkillPin[] {
  return wanted.flatMap((one) => {
    const pin = state.run.pinnedSkills?.[one.name];
    return pin === undefined ? [] : [{ name: one.name, ...pin }];
  });
}

/** Lays the pinned skills out in a folder of the attempt outside the worktree (may use the network). */
export async function layOutSkills(
  port: RegistrySkillsPort,
  repository: string,
  pins: RegistrySkillPin[],
  attemptDirectory: string,
  warnings: string[],
): Promise<AttemptSkills> {
  if (pins.length === 0) return { directory: null, warnings };
  const directory = join(attemptDirectory, 'skills');
  const problems = await port.materialize(repository, pins, directory);
  return {
    directory: problems.length < pins.length ? directory : null,
    warnings: [...warnings, ...problems],
  };
}

/** Writes the warnings about the skills of an attempt, local and of the registry, to its log. */
export function logSkillWarnings(
  log: string,
  specialist: Specialist,
  runtime: Runtime,
  worktree: string,
  skills: AttemptSkills,
): void {
  for (const skill of missingSkills(
    specialist.skills,
    runtime.skillDirectories(worktree, homedir()),
  )) {
    appendFileSync(log, `[aip] warning: skill not found: ${skill}\n`);
  }
  for (const warning of skills.warnings) appendFileSync(log, `[aip] warning: ${warning}\n`);
}
