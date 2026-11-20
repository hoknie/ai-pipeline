import { describe, expect, it } from 'vitest';

import { systemPrompt, type StepInput } from '../../../src/feature/agents/types/index.ts';
import { findSpecialist } from '../../../src/feature/swarm-config/types/index.ts';
import { config } from '../runs/helpers.ts';

const input: StepInput = {
  prompt: 'Do: add a login',
  groupTitle: 'Login',
  stepId: 'plan',
  specialistName: 'Planner',
  skills: [],
  previous: [],
  feedback: null,
  humanAnswer: null,
  decisions: [],
};

const specialist = findSpecialist(config(), 'plan')!;

describe('the project of the service registry in the message', () => {
  it('names the path and the server in the system part', () => {
    const text = systemPrompt(specialist, {
      ...input,
      registryProject: { path: 'acme/backend/api', server: 'registry' },
    });
    expect(text).toContain(
      'Service registry project: `acme/backend/api` (MCP server `registry`); pass this path to the registry tools.',
    );
  });

  it('adds nothing without a project', () => {
    expect(systemPrompt(specialist, input)).not.toContain('Service registry');
  });
});
