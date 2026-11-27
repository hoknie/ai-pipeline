import { describe, expect, it } from 'vitest';
import { parseConfig } from '../../../../src/feature/swarm-config/services/index.ts';
import { atReview, CONFIG } from './helpers.ts';
import { run } from '../helpers.ts';

describe('review policy configuration', () => {
  it('reads an explicit policy and defaults its stagnation threshold', () => {
    const config = parseConfig(CONFIG.replace('stagnant_rounds: 2, ', ''));
    expect(config.pipelines[0]?.steps[2]?.onReject?.review).toEqual({
      stagnantRounds: 2,
      recoveryStep: 'plan',
      escalationSpecialist: 'strong',
      requiredChecks: ['npm run check'],
    });
  });

  it.each([
    ['stagnant_rounds: 2', 'stagnant_rounds: 0', 'stagnant_rounds'],
    ['recovery_step: plan', 'recovery_step: code', 'recovery_step'],
    ['recovery_step: plan', 'recovery_step: gone', 'recovery_step'],
    ['escalation_specialist: strong', 'escalation_specialist: gone', 'escalation_specialist'],
    ['required_checks: [npm run check]', 'required_checks: null', 'required_checks'],
  ])('rejects invalid %s at its field path', (from, to, path) => {
    expect(() => parseConfig(CONFIG.replace(from, to))).toThrow(path);
  });

  it('refuses skipping a required recovery or implementation in a run or variant', () => {
    expect(() => run(1, { configText: CONFIG, skip: ['plan'] })).toThrow(/recovery/);
    expect(() => run(1, { configText: CONFIG, skip: ['code'] })).toThrow(/returns to skipped/);
    expect(() =>
      parseConfig(CONFIG + '      variants:\n        quick: { skip: [plan] }\n'),
    ).toThrow(/recovery/);
    expect(atReview().run.config.pipelines[0]?.steps[2]?.onReject?.review).toBeDefined();
  });
});
