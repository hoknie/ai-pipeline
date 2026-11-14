# Statistics in the web panel

The "Statistics" section shows what the agents used: tokens, cost and time. The numbers come from the [usage journal](../configuration/stats.md) of the daemon; the panel only draws the report. The address is `#stats?period=<7d|30d|90d|all>&project=<path>`, so a link opens the same choice.

## Filters

- **Period:** "7 days", "30 days" (default), "90 days" or "All time". Days count from local midnight, so the tiles and the chart cover the same days.
- **Project:** "All projects" or one project of the list. A click on a project name in the table of projects picks it.

Changing a filter reads the report again without reloading the page. While the section is open, it is read again after a run changes, at most once in 5 seconds.

## Tiles

- "Tokens": the sum, with input and output below. `90k` and `1.5M` are short forms; the exact number is in the tip.
- "Cost" in USD. When some attempts of the period report no cost (for example `agy`), the tile says "without cost: N attempts". With `stats.show_cost: false` the cost is hidden everywhere.
- "Agent work": the time of the attempts of agents; the time of command steps is not in it.
- "Tasks": the number of finished runs of the period, with how many finished, failed or were cancelled.
- Below are the averages per task (tokens, cost, agent work), each with the **median**. The median is the value of the middle task: one huge task moves the average, not the median.

## Charts

- "By day": stacked bars. The "Split" switch picks "Projects" (default) or "Models". The metric switch picks "Tokens", "Cost", "Agent time" or "Tasks". Hover a bar or focus the chart and use the arrow keys to read the tip with the day, the sum and every part. More than 8 projects or models: the 8 largest are drawn and the rest are summed into "Other".
- Colors: a project has its own color (without one it gets a color from the palette of the panel); models take colors from the palette, one per model.
- "Tasks" is not offered in the model split, because one task can run on several models: the chart shows "Tokens" and "Tasks" returns with the projects.
- With "All projects": bars of the shares of the projects in tokens and in agent work.
- A bar of the outcomes of the tasks: finished, failed, cancelled.

Every chart has a name and a table with the same data for a screen reader.

## Tables

- "Projects": all projects of the period; the first row is the total. Headers sort the table, ascending first, then descending; the total stays first. Columns: tasks, tokens, cost, agent work, full time, and the mean and median of tokens and agent work per task.
- Breakdowns: tabs "Specialists", "Models", "Pipeline" and "Runtimes" with attempts, input and output tokens, cost, agent work and tokens per attempt.

## Clear a project's statistics

The button on a project row clears its records after a confirmation. The runs stay; the action cannot be undone. A notification tells how many records were removed, and the report is read again.

## Empty and off

- No data in the period: "No data for the period".
- Collection off (`stats.enabled: false`): a warning with a link to the settings stands above the data collected earlier.
- A failed request shows the error and "Retry".

The section is [set in the settings](settings.md#system).
