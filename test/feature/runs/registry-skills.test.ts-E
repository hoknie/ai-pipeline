import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type {
  RegistrySkillPin,
  RegistrySkillsPort,
} from '../../../src/feature/runs/ports/index.ts';
import {
  heldPins,
  layOutSkills,
  pinsEvent,
  planSkills,
} from '../../../src/feature/runs/services/effects/skills/index.ts';
import { transition } from '../../../src/feature/runs/machine/index.ts';
import type { Specialist } from '../../../src/feature/swarm-config/types/index.ts';
import type { Runtime } from '../../../src/feature/agents/types/index.ts';
import { missingSkills } from '../../../src/feature/agents/services/index.ts';
import { systemPrompt } from '../../../src/feature/agents/types/index.ts';
import { createClaudeRuntime } from '../../../src/feature/agents/clients/claude/index.ts';
import { createCodexRuntime } from '../../../src/feature/agents/clients/codex/index.ts';
import { conversationContext } from '../agents/conversation-context.ts';
import { run } from './helpers.ts';

const specialist = (skills: string[]): Specialist => ({ slug: 'coder', skills }) as Specialist;
const claude = { name: 'claude', loadsExtraSkills: true } as const;
const codex = { name: 'codex', loadsExtraSkills: false } as const;

interface Fixture {
  port: RegistrySkillsPort;
  calls: { pin: string[][]; materialize: RegistrySkillPin[][] };
  /** What the registry offers now. */
  registry: { version: string | null; problems: string[] };
  saved: number;
}

function fixture(): Fixture {
  const f: Fixture = {
    calls: { pin: [], materialize: [] },
    registry: { version: '1.4.1', problems: [] },
    saved: 0,
    port: {
      pin: (_project, references) => {
        f.calls.pin.push([...references]);
        if (f.registry.version === null) {
          return Promise.resolve({ pinned: [], problems: f.registry.problems });
        }
        return Promise.resolve({
          pinned: [{ name: 'go-testing', version: f.registry.version, connection: 'c1' }],
          problems: [],
        });
      },
      materialize: (_project, pinned) => {
        f.calls.materialize.push([...pinned]);
        return Promise.resolve([]);
      },
    },
  };
  return f;
}

/** The steps of an attempt: plan, fix the versions, apply the event, lay the skills out. */
async function prepare(
  f: Fixture,
  state: ReturnType<typeof run>,
  skills: string[],
  runtime: Pick<Runtime, 'name' | 'loadsExtraSkills'> = claude,
) {
  const directory = mkdtempSync(join(tmpdir(), 'aip-attempt-'));
  const plan = planSkills(state, specialist(skills), runtime);
  if (plan.kind === 'none') return { result: { directory: null, warnings: [] }, directory };
  if (plan.kind === 'unsupported') {
    return { result: { directory: null, warnings: plan.warnings }, directory };
  }
  const found =
    plan.missing.length > 0
      ? await f.port.pin(state.run.repository, plan.missing)
      : { pinned: [], problems: [] };
  const event = pinsEvent(found);
  if (event !== null) {
    transition(state, event, 5);
    f.saved += 1;
  }
  const result = await layOutSkills(
    f.port,
    state.run.repository,
    heldPins(state, plan.wanted),
    directory,
    found.problems,
  );
  return { result, directory };
}

const REF = 'registry:go-testing@^1';

describe('registry skills of an attempt', () => {
  it('fixes the version once, lays the skill out outside the worktree and gives the folder', async () => {
    const f = fixture();
    const state = run(1);
    const { result, directory } = await prepare(f, state, [REF, 'local']);
    expect(state.run.pinnedSkills).toEqual({
      'go-testing': { version: '1.4.1', connection: 'c1' },
    });
    expect(f.saved).toBe(1);
    expect(f.calls.pin).toEqual([[REF]]);
    expect(result).toEqual({ directory: join(directory, 'skills'), warnings: [] });
    expect(f.calls.materialize[0]).toEqual([
      { name: 'go-testing', version: '1.4.1', connection: 'c1' },
    ]);
  });

  it('keeps the version when a newer one appears and the step goes back', async () => {
    const f = fixture();
    const state = run(1);
    await prepare(f, state, [REF]);
    f.registry.version = '1.5.0';
    const again = await prepare(f, state, [REF]);
    expect(f.calls.pin).toHaveLength(1);
    expect(f.calls.materialize[1]?.[0]?.version).toBe('1.4.1');
    expect(again.result.warnings).toEqual([]);
    expect(state.run.pinnedSkills?.['go-testing']?.version).toBe('1.4.1');
  });

  it('lets the first fixation win when a parallel attempt fixed another version meanwhile', async () => {
    const f = fixture();
    const state = run(1);
    const original = f.port.pin;
    f.port.pin = async (project, references) => {
      state.run.pinnedSkills = { 'go-testing': { version: '1.2.0', connection: 'c1' } };
      return original(project, references);
    };
    await prepare(f, state, [REF]);
    expect(state.run.pinnedSkills?.['go-testing']?.version).toBe('1.2.0');
    expect(f.calls.materialize[0]?.[0]?.version).toBe('1.2.0');
  });

  it('starts without the skill and fixes nothing while the registry does not answer', async () => {
    const f = fixture();
    f.registry = {
      version: null,
      problems: ['skill not found: registry:go-testing@^1 (unreachable)'],
    };
    const state = run(1);
    const first = await prepare(f, state, [REF]);
    expect(first.result).toEqual({
      directory: null,
      warnings: ['skill not found: registry:go-testing@^1 (unreachable)'],
    });
    expect(state.run.pinnedSkills).toBeUndefined();
    expect(f.calls.materialize).toEqual([]);
    // the next attempt tries again
    f.registry = { version: '1.4.1', problems: [] };
    const next = await prepare(f, state, [REF]);
    expect(f.calls.pin).toHaveLength(2);
    expect(next.result.directory).not.toBeNull();
  });

  it('warns for a runtime that cannot load the folder and starts', async () => {
    const f = fixture();
    const state = run(1);
    const { result } = await prepare(f, state, [REF, 'registry:sql'], codex);
    expect(result).toEqual({
      directory: null,
      warnings: ['registry skills are not supported by runtime codex: go-testing, sql'],
    });
    expect(f.calls.pin).toEqual([]);
  });

  it('does nothing for a specialist with local skills only', async () => {
    const f = fixture();
    const { result } = await prepare(f, run(1), ['review']);
    expect(result).toEqual({ directory: null, warnings: [] });
    expect(f.calls.pin).toEqual([]);
  });
});

describe('registry skills in the message and the lookup of local skills', () => {
  it('names a registry skill by its name only', () => {
    const base = conversationContext('claude');
    const text = systemPrompt({ ...base.specialist, skills: [REF, 'review'] }, base.input);
    expect(text).toContain('Use these skills for this step: go-testing, review.');
    expect(text).not.toContain('registry:');
  });

  it('does not look for a registry skill in the directories of the runtime', () => {
    expect(missingSkills([REF, 'nothing-like-it'], ['/nonexistent'])).toEqual(['nothing-like-it']);
  });
});

describe('runtimes and the folder of skills', () => {
  it('hands the folder to claude with --add-dir and lets it read it', () => {
    const context = {
      ...conversationContext('claude'),
      skillsDirectory: '/state/attempt/skills',
    };
    const runtime = createClaudeRuntime('/bin/claude');
    expect(runtime.loadsExtraSkills).toBe(true);
    const args = runtime.buildLaunch(context).args;
    const at = args.indexOf('/state/attempt/skills');
    expect(args[at - 1]).toBe('--add-dir');
    expect(args.join(' ')).toContain('Read(//state/attempt/skills/**)');
    const without = runtime.buildLaunch(conversationContext('claude')).args;
    expect(without).not.toContain('--add-dir');
  });

  it('gives codex nothing: it does not load extra skills', () => {
    const runtime = createCodexRuntime('/bin/codex');
    expect(runtime.loadsExtraSkills).toBe(false);
    const context = { ...conversationContext('codex'), skillsDirectory: '/state/attempt/skills' };
    expect(JSON.stringify(runtime.buildLaunch(context))).not.toContain('/state/attempt/skills');
  });
});
