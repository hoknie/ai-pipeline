import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';

import type {
  AgentTranscript,
  CatalogEntry,
  RuntimeCatalog,
  RuntimeCatalogs,
  TranscriptEntry,
} from '../../src/feature/agents/types/index.ts';
import {
  catalogEntrySchema,
  configCatalogResponseSchema,
  runtimeCatalogSchema,
  transcriptEntrySchema,
  transcriptSchema,
} from '../../src/presentation/ipc/contract/index.ts';

// The types of `agents` are written by hand; the schemas of the contract must describe the same
// values. `tsc` covers `test`, so a field removed on one side fails the gate.
describe('contract of the agents types', () => {
  it('has the same transcript entry and transcript', () => {
    expectTypeOf<z.infer<typeof transcriptEntrySchema>>().toEqualTypeOf<TranscriptEntry>();
    expectTypeOf<z.infer<typeof transcriptSchema>>().toEqualTypeOf<AgentTranscript>();
  });

  it('has the same catalog types', () => {
    expectTypeOf<z.infer<typeof catalogEntrySchema>>().toEqualTypeOf<CatalogEntry>();
    expectTypeOf<z.infer<typeof runtimeCatalogSchema>>().toEqualTypeOf<RuntimeCatalog>();
    expectTypeOf<
      z.infer<typeof configCatalogResponseSchema>['runtimes']
    >().toEqualTypeOf<RuntimeCatalogs>();
  });

  it('accepts additive stream fragments and legacy text entries', () => {
    expect(transcriptEntrySchema.parse({ kind: 'text', text: 'a', streamId: 's' })).toMatchObject({
      streamId: 's',
    });
    expect(
      transcriptSchema.parse({
        runId: 'r',
        group: 'g',
        seq: null,
        cursor: 1,
        running: false,
        entries: [
          { kind: 'text', text: 'a', streamId: 's' },
          { kind: 'text', text: 'legacy' },
        ],
      }).entries,
    ).toEqual([
      { kind: 'text', text: 'a', streamId: 's' },
      { kind: 'text', text: 'legacy' },
    ]);
    expect(transcriptEntrySchema.safeParse({ kind: 'text', text: '', streamId: '' }).success).toBe(
      false,
    );
    expect(transcriptEntrySchema.safeParse({ kind: 'text', text: '', streamId: 2 }).success).toBe(
      false,
    );
  });
});
