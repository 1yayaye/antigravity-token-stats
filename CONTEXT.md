# CONTEXT: Antigravity Token Usage Stats

## Glossary

### TokenMetric
The numerical count of tokens consumed across LLM interactions.
- **Reasoning (Thinking) Tokens**: Tokens generated during chain-of-thought internal reasoning (`thinking` blocks).
- **Tool Use Tokens**: Tokens consumed for issuing tool calls, tool payloads, and processing tool responses.
- **System Tokens**: Tokens used for system prompts, context prefixes, and developer instructions.
- **Lifetime Tokens**: The cumulative sum of all tokens consumed across all conversations.
- **Peak Tokens**: The highest token count consumed within a single conversation or step.

### TaskSummary
Aggregated execution statistics for the user's workspace and history.
- **Longest Task Duration**: The maximum elapsed time between the initial prompt and final resolution of a task.
- **Current Streak**: The consecutive number of days (up to today) with at least one active conversation turn.
- **Longest Streak**: The maximum historical consecutive active days recorded.

### HeatmapCell
A daily data point in the activity calendar matrix.
- `date`: ISO date string (YYYY-MM-DD).
- `tokenCount`: Total tokens consumed on that day.
- `taskCount`: Total conversation steps or tasks executed on that day.
- `level`: Integer scale from 0 to 4 representing activity intensity for color ramp shading.

### ActivityInsights
Behavioral ratios and volume counts of agent usage.
- `fastModeRate`: Percentage of requests run in Fast Mode vs standard reasoning.
- `mostUsedReasoning`: The most frequent reasoning effort level (e.g., "Extra High · 94%").
- `skillsExplored`: Number of unique skills or custom capabilities activated.
- `totalSkillsUsed`: Cumulative invocations of skills across tasks.
- `totalThreads`: Total count of conversation sessions recorded in the database.

### TokenBreakdown
Exact input, cache-read, thinking, and response token details.

### StatsFilter
Temporal range for data filtering: `today`, `1d`, `7d`, `30d`, or `all`.
The activity heatmap is daily-only.
