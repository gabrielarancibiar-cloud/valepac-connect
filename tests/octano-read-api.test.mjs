import test from 'node:test';
import assert from 'node:assert/strict';
import { crearHandlerOctano } from '../api/octano/_lib/handler.js';
import { consultaOctano } from '../api/octano/_lib/query.js';
import { vistaModulo } from '../api/octano/_lib/read.js';

const TOKEN = 'octano-test-token-' + 'q'.repeat(48);

function request(method = 'GET', query = {}, token = TOKEN) {
  return { method, query, headers: token ? { authorization: `Bearer ${token}` } : {} };
}
function response() {
  return {
    code: 200, headers: {}, body: null,
    setHeader(k, v) { this.headers[k] = v; return this; },
    status(n) { this.code = n; return this; },
    json(body) { this.body = body; return this; },
  };
}
const datos = (modulo) => ({
  resumen: { diferencia: 0, modulo },
  dias: [{ fecha: '2026-10-01', estado: 'conciliado' }, { fecha: '2026-10-02', estado: 'diferencia', diferencia: -999 }],
});

// Tests only use mock data, no calls to actual Supabase nor actions with external services.
test('solo GET: rechaza POST y no invoca origen', async () => {
  process.env.OCTANO_READ_TOKEN = TOKEN;
  let llamadas = 0;
  const h = crearHandlerOctano('recompra', () => { llamadas++; return datos('recompra'); });
  const r = response();
  await h(request('POST'), r);
  assert.equal(r.code, 405);
  assert.equal(llamadas, 0);
  assert.equal(r.headers.Allow, 'GET');
});

test('sin configurar secreto: responde 503 antes de consultar datos', async () => {
  delete process.env.OCTANO_READ_TOKEN;
  let llamadas = 0;
  const r = response();
  await crearHandlerOctano('m2', () => { llamadas++; })(request(), r);
  assert.equal(r.code, 503);
  assert.equal(llamadas, 0);
});

test('deniega falta de token y token incorrecto', async () => {
  process.env.OCTANO_READ_TOKEN = TOKEN;
  let llamadas = 0;
  const h = crearHandlerOctano('muevo', () => { llamadas++; });
  for (const candidate of [null, 'x'.repeat(64)]) {
    const r = response();
    await h(request('GET', {}, candidate), r);
    assert.equal(r.code, 401);
  }
  assert.equal(llamadas, 0);
});

test('GET con token válido entrega datos fuente sin cambiar números', async () => {
  process.env.OCTANO_READ_TOKEN = TOKEN;
  const h = crearHandlerOctano('muevo', async (_, mes) => {
    assert.equal(mes, '2026-10');
    return datos('muevo');
  });
  const r = response();
  await h(request('GET', { periodo: '2026-10' }), r);
  assert.equal(r.code, 200);
  assert.equal(r.body.modulo, 'muevo');
  assert.equal(r.body.datos.dias[1].diferencia, -999);
  assert.match(r.headers['Cache-Control'], /no-store/);
});

test('fecha exacta incluye dia elegido y distingue resumenMes', async () => {
  process.env.OCTANO_READ_TOKEN = TOKEN;
  const h = crearHandlerOctano('recompra', async () => datos('recompra'));
  const r = response();
  await h(request('GET', { fecha: '2026-10-02' }), r);
  assert.equal(r.code, 200);
  assert.equal(r.body.datos.dia.diferencia, -999);
  assert.equal(r.body.datos.resumenMes.modulo, 'recompra');
  assert.equal(r.body.periodo, '2026-10');
});

test('no acepta fechas imposibles, periodo incompatible ni parámetros duplicados', () => {
  for (const q of [
    { fecha: '2026-02-30' }, { periodo: '2026-13' },
    { periodo: '2026-10', fecha: '2026-09-01' },
    { periodo: ['2026-10', '2026-11'] },
  ]) assert.throws(() => consultaOctano(q));
});

test('resumen combina exactamente cuatro lectores sin escritura', async () => {
  process.env.OCTANO_READ_TOKEN = TOKEN;
  const invocaciones = [];
  const h = crearHandlerOctano('resumen', async (modulo, periodo) => {
    invocaciones.push([modulo, periodo]);
    return datos(modulo);
  });
  const r = response();
  await h(request('GET', {periodo:'2026-10'}), r);
  assert.equal(r.code, 200);
  assert.deepEqual(invocaciones.map(x => x[0]), ['conciliacion', 'recompra', 'muevo', 'm2']);
  assert.deepEqual(Object.keys(r.body.datos), ['conciliacion', 'recompra', 'muevo', 'm2']);
});

test('M2 vista diaria no afirma que el resumen mensual sea diario', () => {
  const datosM2 = {resumen:{m2Neto:500},dias:[{fecha:'2026-10-03',m2Neto:20}],detalle:[{fecha:'2026-10-03', m2Neto:20}],diasProductos:[],estados:[]};
  const d = vistaModulo('m2', datosM2, '2026-10-03');
  assert.equal(d.dia.m2Neto, 20);
  assert.equal(d.resumenMes.m2Neto, 500);
  assert.equal(d.detalleDia[0].m2Neto, 20);
});
