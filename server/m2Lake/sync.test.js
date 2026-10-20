import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { sincronizarM2LakeDia } from './sync.js';

const originalFetch = globalThis.fetch;
const previousUrl = process.env.DATA_LAKE_APP_URL;
const previousToken = process.env.DATA_LAKE_INTERNAL_TOKEN;
const hash = 'a'.repeat(64);

before(() => {
  process.env.DATA_LAKE_APP_URL = 'https://lake.example.test';
  process.env.DATA_LAKE_INTERNAL_TOKEN = 'FAKE_FOR_TEST_ONLY';
});
after(() => {
  globalThis.fetch = originalFetch;
  if (previousUrl === undefined) delete process.env.DATA_LAKE_APP_URL;
  else process.env.DATA_LAKE_APP_URL = previousUrl;
  if (previousToken === undefined) delete process.env.DATA_LAKE_INTERNAL_TOKEN;
  else process.env.DATA_LAKE_INTERNAL_TOKEN = previousToken;
});

function simular({ archivo = {ok:true, sha256:hash, registros:2080, capturadoEn:'2026-10-20T23:50:15.000Z'},
  proceso = {ok:true, sha256:hash, capturadoEn:'2026-10-20T23:50:15.000Z', procesadoEn:'2026-10-20T23:50:19.000Z', recompraLake:{actualizado:true,coseducamLineas:7}} } = {}) {
  const llamados = [];
  globalThis.fetch = async (url, opciones) => {
    const ruta = new URL(url).pathname;
    const body = JSON.parse(opciones.body);
    assert.equal(opciones.headers['x-valepac-internal-token'], 'FAKE_FOR_TEST_ONLY');
    llamados.push({ruta,body});
    const data = ruta === '/api/archive' ? archivo : proceso;
    return {ok: data.ok, status: data.ok ? 200 : 503, json: async ()=>data};
  };
  return llamados;
}

test('refrescar usa captura de CopecFuel y verifica SHA al procesar', async()=>{
  const llamados = simular();
  const resultado = await sincronizarM2LakeDia('2026-10-20');
  assert.equal(resultado.capturadoEn,'2026-10-20T23:50:15.000Z');
  assert.equal(resultado.recompraLake.coseducamLineas, 7);
  assert.deepEqual(llamados.map(x=>x.ruta), ['/api/archive','/api/process']);
  assert.deepEqual(llamados[1].body, {fecha:'2026-10-20',sha256Esperado:hash});
});

test('una captura sin SHA impide iniciar el procesamiento', async()=>{
  const llamados = simular({archivo:{ok:true,registros:12}});
  await assert.rejects(sincronizarM2LakeDia('2026-10-20'), /huella/);
  assert.equal(llamados.length,1);
});

test('falla si Recompra/COSEDUCAM no acredita escritura', async()=>{
  simular({proceso:{ok:true,sha256:hash,capturadoEn:'2026-10-20T00:00:00Z',procesadoEn:'2026-10-20T00:00:10Z',recompraLake:{actualizado:false}}});
  await assert.rejects(sincronizarM2LakeDia('2026-10-20'), /M2 y Recompra/);
});

test('no permite procesar una copia distinta de la archivada', async()=>{
  simular({proceso:{ok:true,sha256:'b'.repeat(64),capturadoEn:'2026-10-20T00:00:00Z',procesadoEn:'2026-10-20T00:00:10Z',recompraLake:{actualizado:true}}});
  await assert.rejects(sincronizarM2LakeDia('2026-10-20'), /M2 y Recompra/);
});

test('las fechas inválidas se rechazan sin descargar', async()=>{
  const llamados = simular();
  await assert.rejects(sincronizarM2LakeDia('20-10-2026'), /no es válida/);
  assert.equal(llamados.length,0);
});

test('cierre programado propaga la reserva a archivado y proceso', async()=>{
  const llamados = simular();
  const runId='e35b3260-0fa0-4f05-9a1d-89225d2b001a';
  const resultado = await sincronizarM2LakeDia('2026-10-20',{cierreRunId:runId});
  assert.equal(resultado.sha256,hash);
  assert.deepEqual(llamados[0].body,{fecha:'2026-10-20',cierreRunId:runId});
  assert.deepEqual(llamados[1].body,{fecha:'2026-10-20',cierreRunId:runId,sha256Esperado:hash});
});
