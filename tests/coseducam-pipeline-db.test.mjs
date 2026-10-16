// Edge -> controlador real de preparación -> RPC SQL real. Sin solicitudes de red.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { crearHandler } from '../supabase/functions/coseducam-worker/index.ts';
import { manejarPreparacionWorker } from '../server/coseducam/preparation.js';

let pglitePath;
try { pglitePath=createRequire(new URL('../tools/validation/package.json',import.meta.url)).resolve('@electric-sql/pglite'); }
catch { pglitePath=createRequire(new URL('../../../validation-tools/package.json',import.meta.url)).resolve('@electric-sql/pglite'); }
const { PGlite }=await import(pathToFileURL(pglitePath).href);

test('Edge, controlador y SQL conservan contrato e idempotencia sin efectos operacionales',async()=>{
  const db=new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create table public.coseducam_jobs(fecha date,codigo_eds text,estado text,intentos_tae integer,intentos_enruta integer,numero_guia text);
      create table public.coseducam_guias(fecha date,codigo_eds text,estado text,numero_guia text);
      create table public.copecfuel_resumenes(fecha_desde date,fecha_hasta date,codigo_eds text,datos_origen jsonb,sincronizado_en timestamptz);`);
    await db.exec(await readFile(new URL('../supabase/recompra_lake_paralelo.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/20261015_coseducam_preparacion.sql',import.meta.url),'utf8'));
    await db.exec(`insert into public.coseducam_consumos(identificador_origen,fecha,codigo_eds,transaccion_id,producto,litros)
      values ('storage-line-1','2026-10-15','40098','storage-tx-1','DIESEL',10.125);
      insert into public.copecfuel_resumenes values ('2026-10-15','2026-10-15','40098',
      '{"fuente":"API_OFICIAL_VENTAS_COPECFUEL","precioDieselObservado":{"precio":1100,"repeticiones":5,"transaccionesRevisadas":9,"preciosDistintos":2}}',
      '2026-10-16T00:00:00Z');`);
    const now=new Date('2026-10-16T12:00:00Z');
    const secret='integration-worker-secret-12345';
    const token='integration-test-token-123456';
    const calls=[];
    const handler=crearHandler({env:name=>({VALEPAC_API_URL:'https://valepac-connect.vercel.app/api/conciliacion/muevo-empresa',
      COSEDUCAM_WORKER_SECRET:secret,DAILY_SYNC_TEST_TOKEN:token})[name],ahora:()=>now,
      fetch:async(url,options)=>{
        const endpoint=new URL(url);
        const req={method:options.method,headers:options.headers,query:Object.fromEntries(endpoint.searchParams),
          ...(options.body?{body:JSON.parse(options.body)}:{})};
        const res={statusCode:0,body:null,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};
        const handled=await manejarPreparacionWorker(req,res,{ahora:now,secretoEsperado:secret,
          supabaseAdmin:{rpc:async(name,args)=>{
            calls.push({name,args}); assert.equal(name,'coseducam_preparar_v1');
            const {rows}=await db.query('select public.coseducam_preparar_v1($1::date,$2::boolean) as data',[args.p_fecha,args.p_guardar]);
            return {data:rows[0].data,error:null};
          }}});
        assert.equal(handled,true);
        return new Response(JSON.stringify(res.body),{status:res.statusCode});
      }});
    const invoke=async(mode)=>{
      const response=await handler(new Request(`https://example.invalid/coseducam-worker?modo=${mode}&fecha=2026-10-15`,
        {method:'POST',headers:{'x-daily-test-token':token},body:'{}'}));
      const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));
      assert.equal(data.emisionHabilitada,false);assert.equal(data.confirmacionHabilitada,false);
      return data;
    };
    assert.equal((await invoke('control')).estadoControl,'LISTA_PARA_PREPARAR');
    const first=await invoke('preparar');
    assert.equal(first.estadoControl,'PREPARADA');assert.equal(first.preparado,true);
    assert.equal(first.consumo.litros,10.125);assert.equal(first.consumo.precioDieselObservado.precio,1100);
    assert.equal(first.motivo,'SNAPSHOT_CREADO');
    const repeated=await invoke('preparar');
    assert.equal(repeated.preparacion.id,first.preparacion.id);assert.equal(repeated.motivo,'IDEMPOTENTE');
    await db.exec('update public.coseducam_consumos set litros=11.125');
    const changed=await invoke('preparar');
    assert.equal(changed.estadoControl,'DATOS_CAMBIARON');assert.equal(changed.preparado,false);
    assert.equal(changed.preparacion.snapshot.litros,10.125);
    await db.exec("insert into public.coseducam_guias values('2026-10-15','40098','procesando',null)");
    const blocked=await invoke('preparar');assert.equal(blocked.estadoControl,'BLOQUEADA_REVISION');
    assert.equal(blocked.motivo,'GUIA_EXISTENTE');
    const {rows}=await db.query(`select
      (select count(*)::int from public.coseducam_preparaciones) preparaciones,
      (select count(*)::int from public.coseducam_preparacion_eventos) eventos,
      (select count(*)::int from public.coseducam_jobs) trabajos_operacionales,
      (select count(*)::int from public.coseducam_guias) guias`);
    assert.deepEqual(rows[0],{preparaciones:1,eventos:4,trabajos_operacionales:0,guias:1});
    assert.equal(calls.length,5);
  } finally {await db.close();}
});
