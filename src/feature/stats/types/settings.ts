/** The collection settings the ledger works with: `exclude` is already reduced to repository roots. */
export interface LedgerSettings {
  enabled: boolean;
  /** Roots of the excluded projects. */
  excluded: ReadonlySet<string>;
}

/** The settings as a report shows them. */
export interface StatsSettingsView {
  enabled: boolean;
  exclude: string[];
  showCost: boolean;
  /** When the accumulated history was moved into the journal; null before that. */
  backfilledAt: number | null;
}
