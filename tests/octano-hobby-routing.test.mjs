import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative, dirname } from 'node:path';
import { crearRouterOctano } from '../api/octano.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const modulos = ['conciliacion', 'recompra', 'muevo', 'resumen', 'm2'];
const config = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));

function archivosFunciones(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((item) => {
    if (item.name.startsWith('_') || item.name.startsWith('.')) return [];
    const full = join(dir, item.name);
    if (item.isDirectory()) return archivosFunciones(full);
    return /\.(js|ts)$/.test(item.name) && !item.name.endsWith('.d.ts') ? [relative(root, full)] : [];
  });
}

function response() {
  return {
    statusCode: 200, result: null, headers: {},
    setHeader(key, value) { this.headers[key] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.result = body; return this; },
  };
}

test('Vercel Hobby: hasta 12 funciones y ningún helper expuesto como endpoint', () => {
  const files = archivosFunciones(join(root, 'api'));
  assert.equal(files.length, 12, files.join('\n'));
  assert(files.includes('api/octano.js'));
  assert(!files.includes('api/copecfuel/client.js'));
  assert(!files.some(f => f.startsWith('api/octano/v1/')));
});

test('Vercel enruta los cinco paths a una sola función con el módulo esperado', () => {
  assert.equal(config.rewrites.length, 5);
  for (const modulo of modulos) {
    assert.deepEqual(config.rewrites.find(r => r.source === `/api/octano/v1/${modulo}`), {
      source: `/api/octano/v1/${modulo}`,
      destination: `/api/octano?octano_modulo=${modulo}`,
    });
  }
});

test('router Octano solo admite los cinco módulos autorizados', async () => {
  const invoked = [];
  const handler = crearRouterOctano((modulo) => async (req, res) => {
    invoked.push(modulo);
    return res.status(200).json({ ok: true, modulo });
  });
  for (const modulo of modulos) {
    const res = response();
    await handler({ method: 'GET', query: {octano_modulo: modulo}}, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.result.modulo, modulo);
  }
  assert.deepEqual(invoked, modulos);
  for (const bad of ['sincronizar', '', undefined, ['m2','resumen'], '__proto__']) {
    const res = response();
    await handler({ method: 'GET', query: {octano_modulo: bad}}, res);
    assert.equal(res.statusCode, 404);
  }
  assert.equal(invoked.length, 5);
});

test('función única sigue negando GET sin token y operaciones de escritura', async () => {
  const tokenAnterior = process.env.OCTANO_READ_TOKEN;
  process.env.OCTANO_READ_TOKEN = 'test-'.padEnd(64, 'x');
  try {
    const { default: handler } = await import('../api/octano.js');
    const noAuth = response();
    await handler({ method:'GET', query:{octano_modulo:'m2'}, headers:{} }, noAuth);
    assert.equal(noAuth.statusCode, 401);
    const post = response();
    await handler({ method:'POST', query:{octano_modulo:'recompra'}, headers:{} }, post);
    assert.equal(post.statusCode, 405);
  } finally {
    if (tokenAnterior === undefined) delete process.env.OCTANO_READ_TOKEN;
    else process.env.OCTANO_READ_TOKEN = tokenAnterior;
  }
});
