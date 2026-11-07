export interface CatalogEntry {
  name: string;
  source: 'builtin' | 'project' | 'global';
  file?: string | undefined;
  description?: string | undefined;
}

export interface RuntimeCatalog {
  tools: CatalogEntry[];
  skills: CatalogEntry[];
}

export interface RuntimeCatalogs {
  claude: RuntimeCatalog;
  opencode: RuntimeCatalog;
}
