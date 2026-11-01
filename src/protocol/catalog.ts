import { z } from 'zod';

export const catalogEntrySchema = z.object({
  name: z.string(),
  source: z.enum(['builtin', 'project', 'global']),
  file: z.string().optional(),
  description: z.string().optional(),
});

export type CatalogEntry = z.infer<typeof catalogEntrySchema>;

export const runtimeCatalogSchema = z.object({
  tools: z.array(catalogEntrySchema),
  skills: z.array(catalogEntrySchema),
});

export type RuntimeCatalog = z.infer<typeof runtimeCatalogSchema>;

export const configCatalogResponseSchema = z.object({
  repository: z.string(),
  /** `claude.mcp: inherit` — the MCP servers of the user are available to specialists. */
  mcpInherited: z.boolean(),
  runtimes: z.object({ claude: runtimeCatalogSchema, opencode: runtimeCatalogSchema }),
});

export type ConfigCatalogResponse = z.infer<typeof configCatalogResponseSchema>;
