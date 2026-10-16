import test from 'node:test';
import assert from 'node:assert/strict';
import { crearHandler } from '../supabase/functions/coseducam-worker/index.ts';

const TOKEN = 'test-only-token-1234567890';
const SECRET = 'worker-test-secret-1234567890';
const API = 'https://valepac-connect.vercel.app/api/conciliacion/muevo-empresa';
const good = () => ({ ok:true,fecha:'2026-10-15',codigoEds:'40098',estadoControl:'PREPARADA',
  modificoDatos:true,emisionHabilitada:false,confirmacionHabilitada:false,
  consumo:{litros:125.6,registros:2,precioDieselObservado:{precio:1020}},
  motivo:'SNAPSHOT_CREADO',
  preparacion:{id:'test',fecha:'2026-10-15',codigoEds:'40098',estado:'PREPARADA',snapshot:{litros:125.6}} });

function fixture({ body=good(), status=200, now='2026-10-16T01:00:00Z', env={}, fetch, timeoutMs }={}) {
  const calls=[];
  const handler=crearHandler({
    env:name=>({DAILY_SYNC_TEST_TOKEN:TOKEN,COSEDUCAM_WORKER_SECRET:SECRET,VALEPAC_API_URL:API,...env})[name],
    ahora:()=>new Date(now), timeoutMs,
    fetch:async (...args)=>{ calls.push(args); return fetch ? fetch(...args) : new Response(JSON.stringify(body),{status}); },
  });
  const invoke=async (query='modo=preparar&fecha=2026-10-15', {token=TOKEN,payload='{}',method='POST'}={})=>{
    const res=await handler(new Request(`https://example.invalid/coseducam-worker?${query}`,{
      method, headers:{'x-daily-test-token':token},...(method==='POST'?{body:payload}:{})}));
    return { status:res.status, data:await res.json() };
  };
  return {calls,invoke};
}

test('default and simulation do no I/O, including an old cron invocation', async()=>{
  const f=fixture();
  const r=await f.invoke('',{token:''});
  assert.equal(r.status,200); assert.equal(r.data.accion,'simulacion_sin_operaciones');
  assert.equal(f.calls.length,0); assert.equal(r.data.taeActivado,false);
});

test('only preparation action is sent; flags cannot be enabled by upstream',async()=>{
  const f=fixture(); const r=await f.invoke();
  assert.equal(r.status,200); assert.equal(r.data.preparado,true);
  assert.equal(r.data.emisionHabilitada,false); assert.equal(r.data.confirmacionHabilitada,false);
  assert.equal(r.data.motivo,'SNAPSHOT_CREADO');
  assert.equal(f.calls.length,1); const [url,options]=f.calls[0];
  assert.equal(url,API); assert.equal(options.method,'POST'); assert.equal(options.redirect,'error');
  assert.deepEqual(JSON.parse(options.body),{accion:'preparar_worker_coseducam',fecha:'2026-10-15'});
  assert.equal(options.headers['x-valepac-worker-secret'],SECRET);
  assert.ok(!JSON.stringify(options).includes(TOKEN));
});

test('control and diagnostico are GET reads with no body',async()=>{
  for(const mode of ['control','diagnostico']) {
    const body={...good(),modificoDatos:false,estadoControl:'LISTA_PARA_PREPARAR'};
    const f=fixture({body}); const r=await f.invoke(`modo=${mode}&fecha=2026-10-15`);
    assert.equal(r.status,200); assert.equal(r.data.preparado,false);
    assert.equal(f.calls[0][1].method,'GET'); assert.equal(f.calls[0][1].body,undefined);
    assert.equal(new URL(f.calls[0][0]).searchParams.get('recurso'),'control_worker_coseducam');
  }
});

test('authorization is required before I/O for every operational mode',async()=>{
  for(const mode of ['control','diagnostico','preparar']) {
    for(const token of ['',SECRET,'wrong']) {
      const f=fixture(); assert.equal((await f.invoke(`modo=${mode}`,{token})).status,403);
      assert.equal(f.calls.length,0);
    }
  }
  const f=fixture({env:{DAILY_SYNC_TEST_TOKEN:'short'}});
  assert.equal((await f.invoke()).status,403); assert.equal(f.calls.length,0);
});

test('cutoff and real calendar dates use the date in Santiago',async()=>{
  for(const date of ['2026-10-14','2026-10-16','2026-02-30','2026-13-01','2026-10-15T00:00:00Z']) {
    const f=fixture(); assert.equal((await f.invoke(`modo=preparar&fecha=${date}`)).status,400);
    assert.equal(f.calls.length,0);
  }
  const f=fixture(); const r=await f.invoke('modo=preparar');
  assert.equal(r.data.fechaChile,'2026-10-15');
  assert.equal(JSON.parse(f.calls[0][1].body).fecha,'2026-10-15');
  const body={...good(),fecha:'2026-10-16',preparacion:{...good().preparacion,fecha:'2026-10-16'}};
  assert.equal((await fixture({body,now:'2026-10-16T04:00:00Z'}).invoke('modo=preparar&fecha=2026-10-16')).status,200);
});

test('reject forcing fields, duplicate query parameters, malformed bodies and modes',async()=>{
  for(const [query,payload] of [
    ['modo=preparar&tae=true','{}'],['modo=preparar&fecha=2026-10-15&fecha=2026-10-14','{}'],
    ['modo=productivo','{}'],['modo=preparar','{"accion":"crear_guia_coseducam"}'],
    ['modo=preparar','{"confirmar":true}'],['modo=preparar','[]'],['modo=preparar','null'],
    ['modo=preparar','{'],['modo=preparar',' '.repeat(1025)],
  ]) {
    const f=fixture(); assert.equal((await f.invoke(query,{payload})).status,400); assert.equal(f.calls.length,0);
  }
  const f=fixture(); assert.equal((await f.invoke('',{method:'GET'})).status,405);
});

test('unsafe endpoint configuration never sends the worker secret',async()=>{
  for(const api of ['http://example.invalid/api/conciliacion/muevo-empresa',
    `${API}?extra=1`,'https://user:pass@example.invalid/api/conciliacion/muevo-empresa',
    'https://example.invalid/api/copecfuel/sincronizar']) {
    const f=fixture({env:{VALEPAC_API_URL:api}});
    assert.equal((await f.invoke()).status,503); assert.equal(f.calls.length,0);
  }
});

test('reject old Vercel version, wrong date/EDS, enabled flags and HTTP failure',async()=>{
  for(const body of [null,[],{ok:true},{...good(),fecha:'2026-10-14'},
    {...good(),codigoEds:'40099'},{...good(),emisionHabilitada:true},
    {...good(),confirmacionHabilitada:true},{...good(),ok:false,error:SECRET}]) {
    const f=fixture({body}); const r=await f.invoke(); assert.equal(r.status,502);
    assert.ok(!JSON.stringify(r).includes(SECRET)); assert.equal(f.calls.length,1);
  }
  assert.equal((await fixture({status:503}).invoke()).status,502);
  assert.equal((await fixture({fetch:()=>new Response('<html>error</html>')}).invoke()).status,502);
  assert.equal((await fixture().invoke('modo=control')).status,502);
});

test('a prepared result must identify the persisted snapshot and allowed state',async()=>{
  for(const body of [{...good(),preparacion:null},{...good(),preparacion:{}},
    {...good(),preparacion:{...good().preparacion,fecha:'2026-10-14'}},
    {...good(),preparacion:{...good().preparacion,codigoEds:'40099'}},
    {...good(),preparacion:{...good().preparacion,estado:'emitida'}},
    {...good(),preparacion:{...good().preparacion,snapshot:null}},
    {...good(),estadoControl:'EMITIR'},{...good(),estadoControl:'DATOS_CAMBIARON',preparacion:null},
    {...good(),estadoControl:'LISTA_PARA_PREPARAR'}]) {
    assert.equal((await fixture({body}).invoke()).status,502);
  }
});

test('network errors and timeouts do not retry; a lost write is explicitly unknown',async()=>{
  const f=fixture({fetch:()=>{throw new Error(SECRET)}}); const r=await f.invoke();
  assert.equal(r.status,503); assert.equal(r.data.resultadoDesconocido,true); assert.equal(f.calls.length,1);
  assert.ok(!JSON.stringify(r).includes(SECRET));
  const timed=fixture({timeoutMs:1,fetch:(_url,options)=>new Promise((_,reject)=>{
    options.signal.addEventListener('abort',()=>reject(new Error('timeout')),{once:true});
  })});
  const t=await timed.invoke(); assert.equal(t.status,503); assert.equal(timed.calls.length,1);
  assert.equal(t.data.error,'Tiempo de espera agotado.');
});
