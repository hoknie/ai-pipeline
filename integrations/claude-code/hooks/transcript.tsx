import type { On } from 'claude-code';

import { parseAipTool, toolData, toolOutcome } from './feed.ts';

function targetOf(input: unknown): string {
  if (typeof input !== 'object' || input === null) return '';
  const record = input as Record<string, unknown>;
  const parts = [record.run_id, record.group].filter(
    (part): part is string => typeof part === 'string' && part !== '',
  );
  return parts.length > 0 ? ` ${parts.join('/')}` : '';
}

/**
 * Draws the calls of the aip host tools as one line each. The text the model reads is not
 * touched; anything unrecognised, failed or expanded (ctrl+o) is left to the standard rows.
 */
export function registerTranscript(on: On): void {
  on('ui.render', { component: 'ToolUse' }, ($, e, next) => {
    const tool = parseAipTool(e.props.tool);
    if (!tool || e.props.isErrored || e.props.isExpanded) return next(e);
    const { Text } = $.ui.resolve(e);
    return (
      <Text wrap="truncate-end">
        aip · {tool.replace(/_/g, ' ')}
        {targetOf(e.props.input)}
      </Text>
    );
  });

  on('ui.render', { component: 'ToolResult' }, ($, e, next) => {
    const tool = parseAipTool(e.props.tool);
    if (!tool || e.props.isErrored || e.props.isExpanded) return next(e);
    const outcome = toolOutcome(tool, toolData(e.props.output));
    if (outcome === null) return next(e);
    const { Box, Text } = $.ui.resolve(e);
    return (
      <Box flexDirection="row" gap={1}>
        <Text color={outcome.failed ? 'error' : 'success'}>{outcome.failed ? '✕' : '✓'}</Text>
        <Text wrap="truncate-end">{outcome.text}</Text>
      </Box>
    );
  });
}
