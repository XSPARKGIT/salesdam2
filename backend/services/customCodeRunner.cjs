'use strict';
/**
 * Custom-code runner. Started by customCodeService as a SEPARATE Node process with
 *   --permission (no file system, no child processes, no workers, no native addons),
 *   an empty environment and a capped heap. It holds no secrets and no database
 *   connection: every data operation is an RPC to the parent, which fixes the tenant
 *   and applies the platform's checks. If tenant code escapes the vm context it only
 *   reaches this throw-away process.
 */
const vm = require('vm');

// Remove ways for escaped code to signal other processes (the parent server).
for (const k of ['kill', '_kill', 'binding', '_linkedBinding', 'dlopen']) {
  try { Object.defineProperty(process, k, { value: undefined, writable: false, configurable: false }); } catch { /* ignore */ }
}
// No fetch / builtin-module loader for anything that gets hold of globals.
try { delete globalThis.fetch; delete process.getBuiltinModule; } catch { /* ignore */ }
const send = process.send.bind(process);
const on = process.on.bind(process);
const disconnect = process.disconnect.bind(process);

const pending = new Map();
const inflight = new Set();
let seq = 0;
const rpc = (op, args) => {
  const id = ++seq;
  const p = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  inflight.add(p);
  p.then(() => inflight.delete(p), () => inflight.delete(p));
  send({ type: 'rpc', id, op, args: JSON.parse(JSON.stringify(args === undefined ? [] : args)) });
  return p;
};

on('unhandledRejection', () => { /* a rejected promise inside tenant code must not kill the runner */ });

on('message', async (m) => {
  if (m.type === 'rpc-result') {
    const h = pending.get(m.id);
    if (!h) return;
    pending.delete(m.id);
    if (m.ok) h.resolve(m.value); else h.reject(new Error(m.error));
    return;
  }
  if (m.type !== 'run') return;
  let out = { type: 'done', ok: true, output: null, error: null };
  try {
    const sandbox = {
      inputs: m.inputs || {},
      record: m.record || null,
      ctx: m.ctx || {},
      tenantId: m.tenantId,
      console: {
        log: (...a) => send({ type: 'log', level: 'info', msg: a.map(String).join(' ').slice(0, 2000) }),
        warn: (...a) => send({ type: 'log', level: 'warn', msg: a.map(String).join(' ').slice(0, 2000) }),
        error: (...a) => send({ type: 'log', level: 'error', msg: a.map(String).join(' ').slice(0, 2000) }),
      },
      result: undefined,
      checkConsent: (...a) => rpc('checkConsent', a),
      readRecord: (...a) => rpc('readRecord', a),
      queryRecords: (...a) => rpc('queryRecords', a),
      createRecord: (...a) => rpc('createRecord', a),
      updateRecord: (...a) => rpc('updateRecord', a),
      callApi: (...a) => rpc('callApi', a),
    };
    // Keep the Map-style accessor older snippets used (record.data.get('field')).
    if (sandbox.record && sandbox.record.data) Object.defineProperty(sandbox.record.data, 'get', { value: (k) => sandbox.record.data[k], enumerable: false });
    const ctx = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
    new vm.Script(m.code, { filename: `${m.name}.js` }).runInContext(ctx, { timeout: m.timeoutMs });
    // Let promises started by the script settle (reads/writes it started), then take the result.
    for (let i = 0; i < 200 && inflight.size; i += 1) {
      await Promise.allSettled([...inflight]);
      await new Promise((r) => setImmediate(r));
    }
    let value = sandbox.result !== undefined ? sandbox.result : sandbox.output;
    if (value && typeof value.then === 'function') value = await value;
    const json = value === undefined ? null : JSON.parse(JSON.stringify(value));
    if (JSON.stringify(json).length > 1000000) throw new Error('Output larger than 1 MB');
    out.output = json;
  } catch (err) {
    out = { type: 'done', ok: false, output: null, error: String((err && err.message) || err).slice(0, 2000) };
  }
  send(out, () => { try { disconnect(); } catch { /* ignore */ } process.exit(0); });
});
