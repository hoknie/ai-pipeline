import { describe, expectTypeOf, it } from 'vitest';
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
} from '../../src/protocol/index.ts';

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
});
