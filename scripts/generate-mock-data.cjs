const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function encodeVarint(num) {
  const bytes = [];
  let v = BigInt(num);
  while (v >= 0x80n) {
    bytes.push(Number((v & 0x7fn) | 0x80n));
    v >>= 7n;
  }
  bytes.push(Number(v));
  return Buffer.from(bytes);
}

function makeProto(input, output, cache, thinking, response, model = 'gemini-3.8-flash') {
  const parts = [
    Buffer.concat([Buffer.from([0x10]), encodeVarint(input)]),
    Buffer.concat([Buffer.from([0x18]), encodeVarint(output)]),
    Buffer.concat([Buffer.from([0x28]), encodeVarint(cache)]),
    Buffer.concat([Buffer.from([0x48]), encodeVarint(thinking)]),
    Buffer.concat([Buffer.from([0x50]), encodeVarint(response)]),
  ];
  const usage = Buffer.concat(parts);
  const modelBuf = Buffer.from(model, 'utf8');
  const msg = Buffer.concat([
    Buffer.from([0x22, usage.length]), usage,
    Buffer.from([0x9a, 0x01, modelBuf.length]), modelBuf,
  ]);
  return Buffer.concat([Buffer.from([0x0a, msg.length]), msg]);
}

function generateMockData(targetDir = path.join(__dirname, '..', 'mock-data')) {
  fs.mkdirSync(path.join(targetDir, 'conversations'), { recursive: true });
  const nowSec = Math.floor(Date.now() / 1000);

  const sessions = [
    { id: 'mock-session-today', model: 'gemini-3.8-flash', input: 12500, out: 4200, cache: 85000, think: 3100, resp: 1100, secAgo: 1800 },
    { id: 'mock-session-yesterday', model: 'gemini-2.5-pro', input: 35000, out: 8000, cache: 150000, think: 6000, resp: 2000, secAgo: 86400 * 2 }
  ];

  for (const s of sessions) {
    const db = new DatabaseSync(path.join(targetDir, 'conversations', `${s.id}.db`));
    db.exec('CREATE TABLE gen_metadata (idx INTEGER, data BLOB); CREATE TABLE steps (idx INTEGER, step_type INTEGER, step_payload BLOB, metadata BLOB);');
    db.prepare('INSERT INTO gen_metadata (idx, data) VALUES (?, ?)').run(1, makeProto(s.input, s.out, s.cache, s.think, s.resp, s.model));

    const tsInner = Buffer.concat([Buffer.from([0x08]), encodeVarint(nowSec - s.secAgo)]);
    const tsMeta = Buffer.concat([Buffer.from([0x0a, tsInner.length]), tsInner]);
    db.prepare('INSERT INTO steps (idx, step_type, step_payload, metadata) VALUES (?, ?, ?, ?)').run(1, 14, null, tsMeta);
    db.prepare('INSERT INTO steps (idx, step_type, step_payload, metadata) VALUES (?, ?, ?, ?)').run(2, 15, null, tsMeta);
    db.close();

    const transcriptDir = path.join(targetDir, 'brain', s.id, '.system_generated', 'logs');
    fs.mkdirSync(transcriptDir, { recursive: true });
    fs.writeFileSync(path.join(transcriptDir, 'transcript.jsonl'), [
      JSON.stringify({ created_at: new Date((nowSec - s.secAgo) * 1000).toISOString(), type: 'USER_INPUT' }),
      JSON.stringify({ created_at: new Date((nowSec - s.secAgo + 30) * 1000).toISOString(), type: 'PLANNER_RESPONSE', tool_calls: [{ name: 'run_command' }] })
    ].join('\n') + '\n', 'utf8');
  }
  console.log(`[MockData] Created mock Antigravity data at: ${targetDir}`);
  return targetDir;
}

if (require.main === module) {
  generateMockData(process.argv[2] || process.env.ANTIGRAVITY_DATA_DIR);
}

module.exports = { generateMockData };
