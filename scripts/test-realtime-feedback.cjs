const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-realtime-test-'));
const previousDataDir = process.env.ANTIGRAVITY_DATA_DIR;
process.env.ANTIGRAVITY_DATA_DIR = testDataDir;
process.on('exit', () => {
  if (previousDataDir === undefined) delete process.env.ANTIGRAVITY_DATA_DIR;
  else process.env.ANTIGRAVITY_DATA_DIR = previousDataDir;
  try { fs.rmSync(testDataDir, { recursive: true, force: true }); } catch {}
});

const { computeStats } = require('./aggregate-stats.cjs');

console.log('================================================================');
console.log('   ANTIGRAVITY 2.0 TOKEN STATS - REAL-TIME FEEDBACK SIMULATOR   ');
console.log('================================================================\n');

// 1. Initial State
const before = computeStats();
console.log('[Step 1] Baseline Stats:');
console.log(`  - Total Tasks:    ${before.activity.totalTasks}`);
console.log(`  - Lifetime:       ${before.kpis.lifetimeTokens}`);
console.log(`  - Current Streak: ${before.kpis.currentStreak} days`);
console.log(`  - Scanned DBs:    ${before.meta.scannedConversations} databases\n`);

// 2. Simulate User Interaction (creating or touching a real task step in conversations)
const agDir = testDataDir;
const brainDir = path.join(agDir, 'brain');

console.log('[Step 2] Simulating incoming task activity (Simulating a new tool call & thinking step)...');
const testDir = path.join(brainDir, 'realtime_test_session');
const testLogsDir = path.join(testDir, '.system_generated', 'logs');
fs.mkdirSync(testLogsDir, { recursive: true });

const testTranscriptPath = path.join(testLogsDir, 'transcript.jsonl');
const nowIso = new Date().toISOString();
const simulatedEvents = [
  JSON.stringify({
    created_at: nowIso,
    step_index: 1,
    type: 'USER_INPUT',
    content: 'Live token consumption test query',
  }),
  JSON.stringify({
    created_at: nowIso,
    step_index: 2,
    type: 'PLANNER_RESPONSE',
    tool_calls: [{ name: 'realtime_probe_tool' }],
  }),
].join('\n') + '\n';

fs.writeFileSync(testTranscriptPath, simulatedEvents, 'utf8');
console.log(`  ✓ Wrote test transcript event to: ${testTranscriptPath}\n`);

// 3. Re-compute Stats with incremental cache (force=true simulates real-time push/manual refresh)
const t0 = performance.now();
const after = computeStats(true);
const elapsed = performance.now() - t0;
const taskDiff = after.activity.totalTasks - before.activity.totalTasks;

console.log('[Step 3] Live Update Detection Result:');
console.log(`  - Detection Latency:  ${elapsed.toFixed(2)} ms`);
console.log(`  - Total Tasks:        ${before.activity.totalTasks} -> ${after.activity.totalTasks} (+${taskDiff})`);
console.log(`  - Skills Explored:    ${before.insights.skillsExplored} -> ${after.insights.skillsExplored}`);
console.log(`  - Newest date recorded: ${after.activity.heatmap[after.activity.heatmap.length - 1].date}`);

if (taskDiff < 1) {
  throw new Error(`Realtime detection failed: expected +1 user task, got +${taskDiff}`);
}

console.log('\n  [Real-Time Feedback Loop Confirmed]:');
console.log('  The UI will quietly pick up this update on the next 15-second tick,');
console.log('  or immediately when the user clicks the refresh button in the top-right.');

// Clean up test file so it doesn't pollute user history
try {
  fs.rmSync(testDir, { recursive: true, force: true });
  console.log('\n[Step 4] Cleaned up temporary probe directory cleanly.');
} catch (e) {}

console.log('\n================================================================');
