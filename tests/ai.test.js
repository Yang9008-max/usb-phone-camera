'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { VideoAI, configuration } = require('../app/ai');
const jpeg = fs.readFileSync(path.join(__dirname, '../fixtures/test-frame.jpg'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function mock(handler) {
  const server = http.createServer(handler); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return { url: 'http://127.0.0.1:' + server.address().port + '/v1', close: () => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); } };
}
async function waitFor(condition) {
  const deadline = Date.now() + 3000;
  while (!condition()) { if (Date.now() > deadline) throw Error('Timed out'); await delay(10); }
}
async function requestBody(request) { let value = ''; for await (const chunk of request) value += chunk; return JSON.parse(value); }
function event(response, value) { response.write('data: ' + JSON.stringify(value) + '\n\n'); }

test('continuous clips carry ordered timestamps and prior observations; slow inference skips backlog', async () => {
  const requests = []; let completeFirst;
  const api = await mock(async (req, res) => {
    assert.equal(req.url, '/v1/responses'); assert.equal(req.headers.authorization, 'Bearer fixture-not-a-real-key');
    const body = await requestBody(req); requests.push(body);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.flushHeaders();
    if (requests.length === 1) {
      // Split a Chinese character across network chunks and expose partial text before completion.
      const chunk = Buffer.from('data: ' + JSON.stringify({ type: 'response.output_text.delta', delta: '有人拿起杯子。' }) + '\r\n\r\n');
      const split = chunk.indexOf(Buffer.from('有')) + 1;
      res.write(chunk.subarray(0, split)); await delay(15); res.write(chunk.subarray(split));
      completeFirst = () => { event(res, { type: 'response.completed', response: {} }); res.end(); };
    } else {
      event(res, { type: 'response.output_text.delta', delta: '杯子已经放回桌面。' });
      event(res, { type: 'response.completed', response: {} }); res.end();
    }
  });
  let clock = 100000;
  const ai = new VideoAI({ now: () => clock });
  try {
    ai.start({ baseURL: api.url, apiKey: 'fixture-not-a-real-key', model: 'gpt-6.1-sol', interval: 4 });
    ai.frame(jpeg, clock, 1); clock += 1000; ai.frame(jpeg, clock, 2);
    const pending = ai.tick(); await waitFor(() => completeFirst && ai.status().draft.includes('杯子'));
    assert.equal(ai.status().history.length, 0, 'partial text is visible but not a completed analysis');
    for (let sequence = 3; sequence <= 10; sequence++) { clock += 1000; ai.frame(jpeg, clock, sequence); await ai.tick(); }
    assert.equal(requests.length, 1, 'only one request can be in flight');
    completeFirst(); await pending; ai.heartbeat(); await ai.tick();
    assert.equal(requests.length, 2);
    const first = requests[0].input[0].content, second = requests[1].input[0].content;
    assert.equal(first.filter(item => item.type === 'input_image').length, 2);
    assert.match(first[1].text, /1970-01-01T00:01:40.000Z/);
    assert.match(first[3].text, /画面序号 2/);
    assert.match(second[0].text, /有人拿起杯子/);
    const captions = second.filter(item => item.type === 'input_text').slice(1).map(item => item.text);
    assert.ok(captions.length <= 6); assert.match(captions.at(-1), /画面序号 10/);
    assert.doesNotMatch(captions.join('\n'), /画面序号 [1-6]\b/, 'old queued video is dropped');
    assert.equal(requests[0].store, false); assert.equal(requests[0].reasoning.effort, 'low');
    assert.equal(ai.status().history.at(-1).text, '杯子已经放回桌面。');
    assert.doesNotMatch(JSON.stringify(ai.status()), /fixture-not-a-real-key/);
  } finally { ai.stop(); await api.close(); }
});

test('stop aborts active transmission and destroys the in-memory key; reopening needs a new start', async () => {
  let requested = false, closed = false;
  const api = await mock(async (req, res) => {
    await requestBody(req); requested = true; res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.flushHeaders();
    res.on('close', () => { closed = true; });
  });
  let clock = 100000; const ai = new VideoAI({ now: () => clock });
  try {
    ai.start({ baseURL: api.url, apiKey: 'fixture-secret' }); ai.frame(jpeg, clock, 1); clock += 1000; ai.frame(jpeg, clock, 2);
    const pending = ai.tick(); await waitFor(() => requested); ai.stop(); await pending; await waitFor(() => closed);
    assert.equal(ai.config, null); assert.equal(ai.status().running, false); assert.equal(ai.status().history.length, 0);
    clock += 10000; ai.frame(jpeg, clock, 3); await ai.tick(); assert.equal(ai.status().buffered, 0);
  } finally { ai.stop(); await api.close(); }
});

test('expired viewer lease and stale camera frames never start paid inference', async () => {
  let clock = 100000, calls = 0;
  const ai = new VideoAI({ now: () => clock, fetchImpl: () => { calls++; throw Error('should not request'); } });
  try {
    ai.start({ apiKey: 'fixture-key' }); ai.frame(jpeg, clock, 1); clock += 1000; ai.frame(jpeg, clock, 2);
    clock += 4000; await ai.tick(); assert.equal(calls, 0); assert.equal(ai.status().phase, 'waiting');
    clock += 11000; await ai.tick(); assert.equal(calls, 0); assert.equal(ai.config, null); assert.equal(ai.status().running, false);
  } finally { ai.stop(); }
});

test('API authentication failures stop the loop without exposing provider response contents', async () => {
  const api = await mock(async (req, res) => { await requestBody(req); res.writeHead(401); res.end('fixture-secret-key echoed by provider'); });
  let clock = 100000; const ai = new VideoAI({ now: () => clock });
  try {
    ai.start({ baseURL: api.url, apiKey: 'fixture-secret-key' }); ai.frame(jpeg, clock, 1); clock += 1000; ai.frame(jpeg, clock, 2); await ai.tick();
    assert.equal(ai.status().running, false); assert.match(ai.status().error, /密钥无效/);
    assert.doesNotMatch(JSON.stringify(ai.status()), /fixture-secret-key/); assert.equal(ai.config, null);
  } finally { ai.stop(); await api.close(); }
});

test('compatible Chat Completions sends the same sequence and handles streamed speech-ready text', async () => {
  const api = await mock(async (req, res) => {
    assert.equal(req.url, '/v1/chat/completions'); const body = await requestBody(req);
    assert.equal(body.messages[1].content.filter(item => item.type === 'image_url').length, 2);
    assert.equal(body.reasoning_effort, 'low');
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    event(res, { choices: [{ delta: { content: '物体向右移动。' } }] });
    event(res, { choices: [{ delta: {}, finish_reason: 'stop' }] }); res.end('data: [DONE]\n\n');
  });
  let clock = 100000; const ai = new VideoAI({ now: () => clock });
  try {
    ai.start({ baseURL: api.url, apiKey: 'fixture-key', protocol: 'chat' }); ai.frame(jpeg, clock, 1); clock += 1000; ai.frame(jpeg, clock, 2); await ai.tick();
    assert.equal(ai.status().history[0].text, '物体向右移动。');
  } finally { ai.stop(); await api.close(); }
});

test('rejects insecure remote endpoints and embedded credentials', () => {
  for (const baseURL of ['http://remote.example/v1', 'https://key@example.com/v1', 'https://example.com/v1?key=secret']) {
    assert.throws(() => configuration({ baseURL, apiKey: 'fixture-key' }));
  }
});

test('upstream failures and broken streams stop analysis without publishing partial conclusions', async () => {
  let mode = 'upstream';
  const api = await mock(async (req, res) => {
    await requestBody(req); res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    event(res, { type: 'response.output_text.delta', delta: '尚未完成的描述' });
    if (mode !== 'broken') event(res, { type: 'response.failed', response: { error: { code: mode === 'upstream' ? 'upstream_error' : 'gateway_concurrency_limit', message: 'fixture-secret' } } });
    res.end();
  });
  let clock = 100000; const ai = new VideoAI({ now: () => clock });
  try {
    for (mode of ['upstream', 'concurrency', 'broken']) {
      ai.start({ baseURL: api.url, apiKey: 'fixture-secret' }); ai.frame(jpeg, clock, 1); clock += 1000; ai.frame(jpeg, clock, 2); await ai.tick();
      assert.equal(ai.status().running, false); assert.equal(ai.status().history.length, 0); assert.equal(ai.status().draft, '');
      assert.match(ai.status().error, mode === 'upstream' ? /上游模型请求失败/ : mode === 'concurrency' ? /并发上限/ : /连接中断/);
      assert.doesNotMatch(JSON.stringify(ai.status()), /fixture-secret/);
    }
  } finally { ai.stop(); await api.close(); }
});
