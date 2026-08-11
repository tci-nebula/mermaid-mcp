// Integration + unit tests. Run with: npm test
// Requires the rendering deps (npm install) since PNG/PDF tests drive
// the real headless Chromium via mermaid-cli.
import { spawn } from 'child_process';
import { readFile, rm, mkdtemp } from 'fs/promises';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import assert from 'assert';
import { mermaidToDrawio } from '../drawio.js';

const serverPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'server.js');
let passed = 0;

function ok(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (err) {
    console.error(`  FAIL - ${name}: ${err.message}`);
    process.exitCode = 1;
  }
}

// ---------- drawio.js unit tests (fast, no Chromium) ----------

console.log('drawio unit tests');
{
  const xml = mermaidToDrawio(`flowchart TD
    A[受信ストリーム] --> B{音声あり?}
    B -->|はい| C(LLM)
    B -->|いいえ| D[[字幕抽出]]
    C --> E((ベクトル化))
    D --> E
    E -.->|top-k| F[(ベクトルDB)]
    F <--> G[RAG "統合 & 生成"]`);

  ok('7 vertices', () => assert.equal((xml.match(/vertex="1"/g) || []).length, 7));
  ok('7 edges', () => assert.equal((xml.match(/edge="1"/g) || []).length, 7));
  ok('rhombus for {}', () => assert(xml.includes('rhombus')));
  ok('ellipse for (())', () => assert(xml.includes('ellipse')));
  ok('cylinder for [()]', () => assert(xml.includes('cylinder3')));
  ok('dashed for -.->', () => assert(xml.includes('dashed=1')));
  ok('bidirectional for <-->', () => assert(xml.includes('startArrow=classic')));
  ok('XML escaping', () => assert(xml.includes('統合 &amp; 生成')));
  ok('CJK labels intact', () => assert(xml.includes('受信ストリーム')));

  ok('rejects non-flowchart', () =>
    assert.throws(() => mermaidToDrawio('sequenceDiagram\n  A->>B: hi'), /flowchart diagrams only/));
  ok('rejects empty', () => assert.throws(() => mermaidToDrawio('   \n  ')));
}

// ---------- MCP server integration tests ----------

console.log('server integration tests');
const server = spawn(process.execPath, [serverPath], { stdio: ['pipe', 'pipe', 'inherit'] });
let buf = '';
const pending = new Map();
server.stdout.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (pending.has(msg.id)) pending.get(msg.id)(msg);
  }
});

let nextId = 1;
function request(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 60_000);
    pending.set(id, (msg) => {
      clearTimeout(t);
      resolve(msg);
    });
    server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

const init = await request('initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'test', version: '0.0.0' },
});
ok('initialize', () => assert.equal(init.result.serverInfo.name, 'mermaid-render-mcp'));

const tools = await request('tools/list', {});
ok('lists render_diagram', () =>
  assert(tools.result.tools.some((t) => t.name === 'render_diagram')));

const FLOW = 'flowchart LR\n  A[Input] --> B{Valid?}\n  B -->|yes| C[Save]';

// Surface the server's own error text when a render unexpectedly fails.
function expectSuccess(response) {
  if (response.result.isError) {
    throw new Error(`server returned error: ${response.result.content[0]?.text}`);
  }
  return response.result;
}

const png = await request('tools/call', {
  name: 'render_diagram',
  arguments: { syntax: FLOW },
});
ok('png renders', () => {
  const img = expectSuccess(png).content.find((c) => c.type === 'image');
  assert.equal(img.mimeType, 'image/png');
  assert(Buffer.from(img.data, 'base64').subarray(1, 4).toString() === 'PNG');
});

const pdf = await request('tools/call', {
  name: 'render_diagram',
  arguments: { syntax: FLOW, format: 'pdf' },
});
ok('pdf renders', () => {
  const res = expectSuccess(pdf).content.find((c) => c.type === 'resource');
  assert.equal(res.resource.mimeType, 'application/pdf');
  assert(Buffer.from(res.resource.blob, 'base64').subarray(0, 5).toString() === '%PDF-');
});

const outDir = await mkdtemp(join(tmpdir(), 'mermaid-test-'));
const outFile = join(outDir, 'out.pdf');
await request('tools/call', {
  name: 'render_diagram',
  arguments: { syntax: FLOW, format: 'pdf', output_path: outFile },
});
const written = await readFile(outFile).catch(() => Buffer.alloc(0));
ok('output_path writes file', () => assert(written.subarray(0, 5).toString() === '%PDF-'));
await rm(outDir, { recursive: true, force: true }).catch(() => {});

const dio = await request('tools/call', {
  name: 'render_diagram',
  arguments: { syntax: FLOW, format: 'drawio' },
});
ok('drawio converts', () => {
  const text = dio.result.content[0].text;
  assert(text.startsWith('<mxfile'));
  assert(text.includes('vertex="1"'));
});

const dioBad = await request('tools/call', {
  name: 'render_diagram',
  arguments: { syntax: 'sequenceDiagram\n  A->>B: hi', format: 'drawio' },
});
ok('drawio rejects non-flowchart', () => assert.equal(dioBad.result.isError, true));

const badSyntax = await request('tools/call', {
  name: 'render_diagram',
  arguments: { syntax: 'not a diagram !!!' },
});
ok('invalid syntax errors', () => assert.equal(badSyntax.result.isError, true));

const badFormat = await request('tools/call', {
  name: 'render_diagram',
  arguments: { syntax: FLOW, format: 'exe' },
});
ok('invalid format errors', () => assert.equal(badFormat.result.isError, true));

server.kill();
console.log(process.exitCode ? 'FAILED' : `all ${passed} tests passed`);
process.exit(process.exitCode ?? 0);
