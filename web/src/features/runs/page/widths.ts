/** Widths (px) of the columns: the filters, their collapsed strip and the list of runs. */
export const FILTERS_WIDTH = 256;
export const STRIP_WIDTH = 40;
export const LIST_WIDTH = 320;
/** Collapsing frees FILTERS_WIDTH − STRIP_WIDTH px: 2/3 of it goes to the list, 1/3 to the run. */
export const LIST_WIDTH_COLLAPSED =
  LIST_WIDTH + Math.round(((FILTERS_WIDTH - STRIP_WIDTH) * 2) / 3);

/** The tags chosen before the filters were stored together, so that the choice survives. */
function legacyTags(): string[] {
  try {
    const raw = window.localStorage.getItem('aip.web.runTags');
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}
