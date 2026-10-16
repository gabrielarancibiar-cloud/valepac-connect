// Referencia Daily Sync v2026-10-15.6 sin cambios; solo se ejecuta en este sandbox.
// Todas las solicitudes se interceptan: ninguna prueba usa servicios externos.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { test } from 'node:test';
import { createContext, Script } from 'node:vm';
import { crearHandler } from '../supabase/functions/coseducam-worker/index.ts';

const BASE = 'https://valepac.example.invalid';
const SECRET = 'test-only-shared-worker-secret-123456';
const TOKEN = 'test-only-daily-token-1234567890';
const NOW = '2026-10-16T11:00:00Z'; // 08:00 America/Santiago.
const FECHA = '2026-10-15';
const RUN_DATE = '2026-10-16';
const CONTROL = '/api/copecfuel/sincronizar?daily_control=1';
const ENTORNO = Object.freeze({
  VALEPAC_BASE_URL: BASE,
  VALEPAC_API_URL: `${BASE}/api/conciliacion/muevo-empresa`,
  COSEDUCAM_WORKER_SECRET: SECRET,
  DAILY_SYNC_TEST_TOKEN: TOKEN,
  DAILY_SYNC_AUTO_HABILITADO: 'true',
});
const source = await readFile(new URL('./fixtures/valepac-daily-sync-20261015.reference.ts', import.meta.url), 'utf8');
const script = new Script(stripTypeScriptTypes(source), {
  filename: 'valepac-daily-sync-20261015.reference.ts',
});

class FechaFija extends Date {
  constructor(...argumentos) {
    if (argumentos.length === 0) super(NOW);
    else super(...argumentos);
  }
  static now() { return new Date(NOW).getTime(); }
}

function completoCopecfuel() {
  return {
    ok: true,
    m2Lake: { actualizado: true, recompraLake: { actualizado: true, ok: true } },
    poa: { actualizado: true },
    eerrProductos: { actualizado: true, registros: 2 },
  };
}

function cargarDaily(fetch) {
  let handler;
  const sandbox = createContext({
    Deno: {
      env: { get: (nombre) => ENTORNO[nombre] },
      serve: (funcion) => { handler = funcion; },
    },
    fetch, Date: FechaFija, Intl, URL, Response, AbortController, setTimeout, clearTimeout,
  });
  script.runInContext(sandbox);
  assert.equal(typeof handler, 'function');
  return handler;
}

async function fallarPreparacion() {
  const llamadas = [];
  const handler = crearHandler({
    env: (nombre) => ENTORNO[nombre],
    ahora: () => new Date(NOW),
    fetch: async (url, opciones) => {
      llamadas.push({ url, opciones });
      throw new Error('Fallo local simulado del controlador de preparación.');
    },
  });
  const response = await handler(new Request(`https://edge.example.invalid/coseducam-worker?modo=preparar&fecha=${FECHA}`, {
    method: 'POST', headers: { 'x-daily-test-token': TOKEN }, body: '{}',
  }));
  const resultado = await response.json();
  assert.equal(response.status, 503);
  assert.equal(resultado.accion, 'vercel_sin_respuesta_confirmada');
  assert.equal(resultado.resultadoDesconocido, true);
  assert.equal(llamadas.length, 1);
  assert.equal(new URL(llamadas[0].url).pathname, '/api/conciliacion/muevo-empresa');
  assert.deepEqual(JSON.parse(llamadas[0].opciones.body), {
    accion: 'preparar_worker_coseducam', fecha: FECHA,
  });
}

async function ejecutarDaily(tipo, payload) {
  const llamadas = [];
  const id = tipo === 'copecfuel' ? 101 : 105;
  const claimToken = `test-only-claim-${tipo}`;
  const rutaSync = tipo === 'copecfuel'
    ? `/api/copecfuel/sincronizar?desde=${FECHA}&hasta=${FECHA}`
    : `/api/copec/sincronizar?periodo=10%3B2026&fecha_desde=${FECHA}`;
  const rutasEsperadas = [CONTROL, CONTROL, rutaSync, CONTROL];
  const handler = cargarDaily(async (rawUrl, opciones) => {
    const url = new URL(rawUrl);
    const ruta = `${url.pathname}${url.search}`;
    const posicion = llamadas.length;
    assert.equal(url.origin, BASE);
    assert.equal(ruta, rutasEsperadas[posicion]);
    assert.equal(opciones.method, 'POST');
    assert.equal(opciones.headers['x-valepac-worker-secret'], SECRET);
    assert.equal(opciones.headers['x-daily-test-token'], undefined);
    assert.notEqual(url.pathname, '/api/conciliacion/muevo-empresa');
    const body = JSON.parse(opciones.body);
    llamadas.push({ ruta, body });
    let respuesta;
    if (posicion === 0) {
      assert.deepEqual(body, { action: 'schedule', runDate: RUN_DATE });
      respuesta = { ok: true };
    } else if (posicion === 1) {
      assert.deepEqual(body, { action: 'claim', runDate: RUN_DATE });
      respuesta = { ok: true, state: 'claimed', id, token: claimToken, step_date: FECHA, step_type: tipo };
    } else if (posicion === 2) {
      assert.deepEqual(body, {});
      respuesta = payload;
    } else {
      assert.equal(body.action, 'finish');
      assert.equal(body.runDate, RUN_DATE);
      assert.equal(body.id, id);
      assert.equal(body.token, claimToken);
      respuesta = { ok: true };
    }
    return new Response(JSON.stringify(respuesta), { status: 200 });
  });
  const response = await handler(new Request('https://edge.example.invalid/valepac-daily-sync?modo=automatico', {
    method: 'POST', body: '{}',
  }));
  const resultado = await response.json();
  assert.equal(llamadas.length, 4);
  assert.deepEqual(llamadas.map(({ ruta }) => ruta), rutasEsperadas);
  assert.equal(resultado.fechaChile, RUN_DATE);
  assert.equal(resultado.horaChile, '08:00:00');
  return { response, resultado, llamadas };
}

for (const tipo of ['copecfuel', 'portal']) {
  test(`fallo de preparación no interrumpe Job 2 Daily Sync: ${tipo}`, async () => {
    await fallarPreparacion();
    const payload = tipo === 'copecfuel' ? completoCopecfuel() : {
      ok: true, facturasError: null, preciosCostoError: null, fluctuacionesRecompraError: null,
    };
    const { response, resultado, llamadas } = await ejecutarDaily(tipo, payload);
    assert.equal(response.status, 200);
    assert.equal(resultado.ok, true);
    assert.equal(resultado.accion, 'paso_completado');
    assert.equal(resultado.tipo, tipo);
    assert.equal(resultado.fecha, FECHA);
    assert.equal(llamadas[3].body.ok, true);
    assert.equal(Object.hasOwn(llamadas[3].body, 'error'), false);
  });
}

test('Daily exige los módulos completos de CopecFuel antes de finalizar con éxito', async () => {
  for (const modulo of ['m2Lake', 'recompraLake', 'poa', 'eerrProductos']) {
    const payload = completoCopecfuel();
    if (modulo === 'recompraLake') delete payload.m2Lake.recompraLake;
    else delete payload[modulo];
    const { response, resultado, llamadas } = await ejecutarDaily('copecfuel', payload);
    assert.equal(response.status, 502, modulo);
    assert.equal(resultado.accion, 'revision_requerida', modulo);
    assert.equal(llamadas[3].body.ok, false, modulo);
    assert.match(llamadas[3].body.error, /módulos incompletos/, modulo);
  }
});
