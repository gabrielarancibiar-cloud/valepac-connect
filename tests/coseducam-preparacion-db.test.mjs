// Pruebas SQL reales en PostgreSQL embebido. No usa ni modifica Supabase real.
// Dependencia de validación separada: validation-tools/@electric-sql/pglite.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

let modulePath;
try {
  modulePath = createRequire(import.meta.url).resolve('@electric-sql/pglite');
} catch {
  try {
    modulePath = createRequire(new URL('../tools/validation/package.json', import.meta.url)).resolve('@electric-sql/pglite');
  } catch {
    modulePath = createRequire(new URL('../../../validation-tools/package.json', import.meta.url)).resolve('@electric-sql/pglite');
  }
}
const { PGlite } = await import(pathToFileURL(modulePath).href);
const db = new PGlite();
const fecha = '2026-10-15';
const precioValido = { precio: 1100, repeticiones: 5, transaccionesRevisadas: 9, preciosDistintos: 2 };

await db.exec(`
  create role anon;
  create role authenticated;
  create role service_role bypassrls;
  create table public.coseducam_jobs (
    id bigint generated always as identity primary key,
    fecha date, codigo_eds text, estado text, intentos_tae integer,
    intentos_enruta integer, numero_guia text
  );
  create table public.coseducam_guias (
    id bigint generated always as identity primary key,
    fecha date, codigo_eds text, estado text, numero_guia text
  );
  -- Compatibilidad defensiva: el esquema recompra_lake_paralelo.sql sí tiene
  -- identificador_origen; esta fixture omite la columna opcional del snapshot.
  create table public.coseducam_consumos (
    fecha date, codigo_eds text, transaccion_id text, producto text, litros numeric
  );
  create table public.copecfuel_resumenes (
    fecha_desde date, fecha_hasta date, codigo_eds text,
    datos_origen jsonb, sincronizado_en timestamptz
  );
`);
await db.exec(await readFile(new URL('../supabase/migrations/20261015_coseducam_preparacion.sql', import.meta.url), 'utf8'));

async function control(guardar = false, dia = fecha) {
  const { rows } = await db.query('select public.coseducam_preparar_v1($1::date, $2::boolean) as resultado', [dia, guardar]);
  const result = rows[0].resultado;
  assert.equal(result.fecha, dia);
  assert.equal(result.codigoEds, '40098');
  assert.equal(result.emisionHabilitada, false);
  assert.equal(result.confirmacionHabilitada, false);
  return result;
}
async function consumo(litros = '10.125', transaccionId = 'tx-1', producto = 'DIESEL', eds = '40098') {
  await db.query('insert into public.coseducam_consumos values ($1::date, $2, $3, $4, $5::numeric)', [fecha, eds, transaccionId, producto, litros]);
}
async function precio(observado = precioValido, sincronizado = '2026-10-16T00:00:00Z', extras = {}) {
  await db.query('insert into public.copecfuel_resumenes values ($1::date, $2::date, $3, $4::jsonb, $5::timestamptz)', [
    fecha, extras.hasta || fecha, extras.eds || '40098',
    JSON.stringify({ fuente: extras.fuente || 'API_OFICIAL_VENTAS_COPECFUEL', precioDieselObservado: observado }), sincronizado,
  ]);
}
async function trabajo(overrides = {}) {
  const j = { estado: 'pendiente', tae: 0, enruta: 0, guia: null, ...overrides };
  await db.query('insert into public.coseducam_jobs (fecha,codigo_eds,estado,intentos_tae,intentos_enruta,numero_guia) values ($1::date,\'40098\',$2,$3,$4,$5)', [fecha, j.estado, j.tae, j.enruta, j.guia]);
}
async function counts() {
  const { rows } = await db.query(`select
    (select count(*)::int from public.coseducam_preparaciones) preparaciones,
    (select count(*)::int from public.coseducam_preparacion_eventos) eventos`);
  return rows[0];
}
async function sources() {
  const { rows } = await db.query(`select jsonb_build_object(
    'jobs', (select coalesce(jsonb_agg(to_jsonb(j)), '[]') from public.coseducam_jobs j),
    'guias', (select coalesce(jsonb_agg(to_jsonb(g)), '[]') from public.coseducam_guias g),
    'consumos', (select coalesce(jsonb_agg(to_jsonb(c)), '[]') from public.coseducam_consumos c),
    'precios', (select coalesce(jsonb_agg(to_jsonb(p)), '[]') from public.copecfuel_resumenes p)
  ) datos`);
  return rows[0].datos;
}

await test('RPC preparación: SQL real, aislamiento y permisos', async (t) => {
  async function scenario(name, run) {
    await t.test(name, async () => {
      await db.exec('begin');
      try { await run(); } finally { await db.exec('rollback'); }
    });
  }

  await scenario('fecha mínima, futuro, fecha y guardar nulos se rechazan', async () => {
    const futuro = (await db.query("select ((statement_timestamp() at time zone 'America/Santiago')::date + 1)::text fecha")).rows[0].fecha;
    for (const [dia, guardar] of [['2026-10-14', false], [futuro, false], [null, false], [fecha, null]]) {
      await db.exec('savepoint invalida');
      await assert.rejects(db.query('select public.coseducam_preparar_v1($1::date, $2::boolean)', [dia, guardar]), { code: '22023' });
      await db.exec('rollback to savepoint invalida');
    }
    assert.deepEqual(await counts(), { preparaciones: 0, eventos: 0 });
  });

  await scenario('ausencia no acredita día sin consumo; GET no escribe', async () => {
    const result = await control();
    assert.equal(result.estadoControl, 'ESPERANDO_CONSUMO');
    assert.deepEqual(result.consumo, { litros: 0, registros: 0, precioDieselObservado: null });
    assert.equal(result.modificoDatos, false);
    assert.deepEqual(await counts(), { preparaciones: 0, eventos: 0 });
    assert.equal((await control(true)).estadoControl, 'ESPERANDO_CONSUMO');
    assert.deepEqual(await counts(), { preparaciones: 0, eventos: 1 });
  });

  await scenario('preparación solo aislada, consulta previa y reintento idempotente auditado', async () => {
    await consumo(); await consumo('20.250', 'tx-2'); await precio(); await trabajo();
    const before = await sources();
    const consulta = await control();
    assert.equal(consulta.estadoControl, 'LISTA_PARA_PREPARAR');
    assert.equal(consulta.consumo.litros, 30.375);
    assert.equal(consulta.consumo.registros, 2);
    assert.equal(consulta.consumo.precioDieselObservado.precio, 1100);
    assert.deepEqual(await counts(), { preparaciones: 0, eventos: 0 });
    const first = await control(true);
    const second = await control(true);
    assert.equal(first.estadoControl, 'PREPARADA');
    assert.equal(second.estadoControl, 'PREPARADA');
    assert.deepEqual(first.preparacion, second.preparacion);
    assert.equal(first.modificoDatos, true);
    assert.deepEqual(await sources(), before);
    assert.deepEqual(await counts(), { preparaciones: 1, eventos: 2 });
    const events = (await db.query('select evidencia from public.coseducam_preparacion_eventos order by id')).rows;
    assert.equal(events[1].evidencia.motivo, 'IDEMPOTENTE');
    assert.equal(events[1].evidencia.nuevaPreparacion, false);
    assert.equal((await control()).modificoDatos, false);
    assert.deepEqual(await counts(), { preparaciones: 1, eventos: 2 });
  });

  await scenario('sin job previo también prepara sin crear jobs ni guías', async () => {
    await consumo(); await precio();
    const before = await sources();
    assert.equal((await control(true)).estadoControl, 'PREPARADA');
    assert.deepEqual(await sources(), before);
  });

  await scenario('EDS e identidad numéricos y producto Diesel normalizado usan el mismo contrato', async () => {
    await db.exec(`
      alter table public.coseducam_jobs alter column codigo_eds type integer using codigo_eds::integer;
      alter table public.coseducam_guias alter column codigo_eds type integer using codigo_eds::integer;
      alter table public.coseducam_consumos alter column codigo_eds type integer using codigo_eds::integer;
      alter table public.coseducam_consumos alter column transaccion_id type bigint using transaccion_id::bigint;
      alter table public.copecfuel_resumenes alter column codigo_eds type integer using codigo_eds::integer;
    `);
    await db.query("insert into public.coseducam_consumos values ($1::date, 40098, 123, ' Diesel ', 10.125)", [fecha]);
    await precio();
    const result = await control(true);
    assert.equal(result.estadoControl, 'PREPARADA');
    assert.equal(result.preparacion.snapshot.consumos[0].transaccionId, '123');
    assert.equal(result.preparacion.snapshot.consumos[0].producto, 'DIESEL');
  });

  await scenario('cambio de consumo bloquea y conserva exactamente el snapshot', async () => {
    await consumo(); await precio();
    const first = await control(true);
    await db.exec("update public.coseducam_consumos set litros = 11 where transaccion_id = 'tx-1'");
    const changed = await control(true);
    assert.equal(changed.estadoControl, 'DATOS_CAMBIARON');
    assert.deepEqual(changed.preparacion, first.preparacion);
    assert.deepEqual(await counts(), { preparaciones: 1, eventos: 2 });
  });

  await scenario('cambio de precio bloquea; resincronización idéntica solo audita nueva evidencia', async () => {
    await consumo(); await precio();
    const first = await control(true);
    await precio(precioValido, '2026-10-16T01:00:00Z');
    const same = await control(true);
    assert.equal(same.estadoControl, 'PREPARADA');
    assert.deepEqual(same.preparacion, first.preparacion);
    assert.notEqual(same.consumo.precioDieselObservado.sincronizadoEn, first.consumo.precioDieselObservado.sincronizadoEn);
    await precio({ ...precioValido, precio: 1150 }, '2026-10-16T02:00:00Z');
    const changed = await control(true);
    assert.equal(changed.estadoControl, 'DATOS_CAMBIARON');
    assert.deepEqual(changed.preparacion, first.preparacion);
  });

  await scenario('captura más reciente inválida nunca cae al precio viejo válido', async () => {
    await consumo(); await precio(); await precio(null, '2026-10-16T01:00:00Z');
    const result = await control(true);
    assert.equal(result.estadoControl, 'ESPERANDO_PRECIO');
    assert.equal(result.consumo.precioDieselObservado, null);
    assert.deepEqual(await counts(), { preparaciones: 0, eventos: 1 });
  });

  await scenario('tres capturas empatadas: dos iguales no ocultan la tercera distinta', async () => {
    await consumo(); await precio(); await precio(); await precio({ ...precioValido, precio: 1200 });
    const result = await control(true);
    assert.equal(result.estadoControl, 'ESPERANDO_PRECIO');
    assert.equal(result.consumo.precioDieselObservado, null);
  });

  await scenario('origen oficial, EDS y rango exacto del precio son obligatorios', async () => {
    await consumo();
    await precio(precioValido, undefined, { fuente: 'OTRO_ORIGEN' });
    await precio(precioValido, undefined, { eds: '99999' });
    await precio(precioValido, undefined, { hasta: '2026-10-16' });
    assert.equal((await control(true)).estadoControl, 'ESPERANDO_PRECIO');
    assert.deepEqual(await counts(), { preparaciones: 0, eventos: 1 });
  });

  await scenario('fecha de sincronización desconocida bloquea recurrir a una captura vieja', async () => {
    await consumo(); await precio(); await precio(precioValido, null);
    assert.equal((await control(true)).estadoControl, 'ESPERANDO_PRECIO');
  });

  for (const [label, valor] of [['cero', 0], ['negativo', -3], ['texto', '1100'], ['sin metadatos', undefined]]) {
    await scenario(`precio ${label} no habilita preparación`, async () => {
      await consumo(); await precio(valor === undefined ? { precio: 1100 } : { ...precioValido, precio: valor });
      const result = await control(true);
      assert.equal(result.estadoControl, 'ESPERANDO_PRECIO');
      assert.equal(result.consumo.precioDieselObservado, null);
    });
  }

  for (const [label, litros, transaccionId, producto] of [
    ['nulo', null, 'tx-1', 'DIESEL'], ['cero', 0, 'tx-1', 'DIESEL'],
    ['negativo', -1, 'tx-1', 'DIESEL'], ['NaN', 'NaN', 'tx-1', 'DIESEL'],
    ['identidad vacía', 10, '', 'DIESEL'], ['producto inválido', 10, 'tx-1', 'GASOLINA 93'],
  ]) {
    await scenario(`consumo ${label} invalida el conjunto completo`, async () => {
      await consumo('5', 'tx-valida'); await consumo(litros, transaccionId, producto); await precio();
      const result = await control(true);
      assert.equal(result.estadoControl, 'BLOQUEADA_REVISION');
      assert.equal(result.consumo.litros, null);
      assert.equal(result.consumo.registros, 2);
      assert.deepEqual(await counts(), { preparaciones: 0, eventos: 1 });
    });
  }

  await scenario('un consumo que se vuelve inválido bloquea el snapshot previo como DATOS_CAMBIARON', async () => {
    await consumo(); await precio(); const first = await control(true);
    await db.exec('update public.coseducam_consumos set litros = null');
    const result = await control(true);
    assert.equal(result.estadoControl, 'DATOS_CAMBIARON');
    assert.equal(result.consumo.litros, null);
    assert.deepEqual(result.preparacion, first.preparacion);
  });

  for (const [label, overrides] of [
    ['estado inseguro', { estado: 'emitiendo' }], ['TAE intentado', { tae: 1 }],
    ['EnRuta intentado', { enruta: 1 }], ['guía en job', { guia: '123' }],
    ['intentos desconocidos', { tae: null }],
  ]) {
    await scenario(`job con ${label} bloquea`, async () => {
      await consumo(); await precio(); await trabajo(overrides);
      assert.equal((await control(true)).estadoControl, 'BLOQUEADA_REVISION');
      assert.deepEqual(await counts(), { preparaciones: 0, eventos: 1 });
    });
  }

  await scenario('duplicados de jobs bloquean aunque todos estén pendientes', async () => {
    await consumo(); await precio(); await trabajo(); await trabajo();
    assert.equal((await control(true)).estadoControl, 'BLOQUEADA_REVISION');
    assert.deepEqual(await counts(), { preparaciones: 0, eventos: 1 });
  });

  for (const cantidad of [1, 2]) {
    await scenario(`${cantidad} guía(s) existente(s) bloquean incluso sin número o anuladas`, async () => {
      await consumo(); await precio();
      for (let i = 0; i < cantidad; i++) await db.query("insert into public.coseducam_guias (fecha,codigo_eds,estado) values ($1::date,'40098','anulada')", [fecha]);
      assert.equal((await control(true)).estadoControl, 'BLOQUEADA_REVISION');
      assert.deepEqual(await counts(), { preparaciones: 0, eventos: 1 });
    });
  }

  await scenario('no exige columnas desconocidas de jobs/guías y falla cerrado si faltan intentos', async () => {
    await db.exec('alter table public.coseducam_jobs drop column intentos_enruta');
    await db.query("insert into public.coseducam_jobs (fecha,codigo_eds,estado,intentos_tae) values ($1::date,'40098','pendiente',0)", [fecha]);
    await consumo(); await precio();
    assert.equal((await control(true)).estadoControl, 'BLOQUEADA_REVISION');
  });

  await scenario('permisos mínimos, RLS sin políticas públicas y RPC solo service_role', async () => {
    const { rows } = await db.query(`select
      has_function_privilege('anon','public.coseducam_preparar_v1(date,boolean)','EXECUTE') anon_rpc,
      has_function_privilege('authenticated','public.coseducam_preparar_v1(date,boolean)','EXECUTE') auth_rpc,
      has_function_privilege('service_role','public.coseducam_preparar_v1(date,boolean)','EXECUTE') service_rpc,
      has_table_privilege('anon','public.coseducam_preparaciones','SELECT') anon_lectura,
      has_table_privilege('authenticated','public.coseducam_preparaciones','INSERT') auth_escritura,
      has_table_privilege('service_role','public.coseducam_preparaciones','INSERT') service_escritura,
      has_table_privilege('service_role','public.coseducam_preparacion_eventos','DELETE') service_borrar,
      (select bool_and(relrowsecurity) from pg_class where oid in (
        'public.coseducam_preparaciones'::regclass,'public.coseducam_preparacion_eventos'::regclass)) rls,
      (select count(*)::int from pg_policies where tablename in ('coseducam_preparaciones','coseducam_preparacion_eventos')) politicas
    `);
    assert.deepEqual(rows[0], { anon_rpc: false, auth_rpc: false, service_rpc: true, anon_lectura: false, auth_escritura: false, service_escritura: false, service_borrar: false, rls: true, politicas: 0 });
    await consumo(); await precio();
    await db.exec('set local role service_role');
    assert.equal((await control(true)).estadoControl, 'PREPARADA');
    await db.exec('reset role');
    assert.deepEqual(await counts(), { preparaciones: 1, eventos: 1 });
    await db.exec('savepoint anon_denegado; set local role anon');
    await assert.rejects(control(), { code: '42501' });
    await db.exec('rollback to savepoint anon_denegado');
  });

  await scenario('snapshot y eventos son inmutables incluso para propietario', async () => {
    await consumo(); await precio(); await control(true);
    for (const sql of [
      "update public.coseducam_preparaciones set snapshot = '{}'",
      'delete from public.coseducam_preparaciones',
      "update public.coseducam_preparacion_eventos set evidencia = '{}'",
      'delete from public.coseducam_preparacion_eventos',
    ]) {
      await db.exec('savepoint inmutable');
      await assert.rejects(db.exec(sql), { code: '55000' });
      await db.exec('rollback to savepoint inmutable');
    }
    assert.deepEqual(await counts(), { preparaciones: 1, eventos: 1 });
  });

  await scenario('si la auditoría falla, la misma sentencia revierte también la preparación', async () => {
    await consumo(); await precio();
    await db.exec(`
      create function public.prueba_fallar_auditoria() returns trigger language plpgsql as $$
        begin raise exception 'Fallo simulado de persistencia'; end;
      $$;
      create trigger prueba_fallar_auditoria before insert on public.coseducam_preparacion_eventos
        for each row execute function public.prueba_fallar_auditoria();
      savepoint fallo_auditoria;
    `);
    await assert.rejects(control(true), { code: 'P0001' });
    await db.exec('rollback to savepoint fallo_auditoria');
    assert.deepEqual(await counts(), { preparaciones: 0, eventos: 0 });
  });

  await scenario('guardar mantiene locks SHARE en fuentes y advisory de la clave hasta commit', async () => {
    await consumo(); await precio(); await control(true);
    const locks = (await db.query(`select c.relname, l.mode from pg_locks l join pg_class c on c.oid=l.relation
      where l.pid = pg_backend_pid() and l.granted and l.mode = 'ShareLock'
      and c.relname in ('coseducam_jobs','coseducam_guias','coseducam_consumos','copecfuel_resumenes')`)).rows;
    assert.equal(locks.length, 4);
    const advisory = (await db.query("select count(*)::int cantidad from pg_locks where pid = pg_backend_pid() and granted and locktype = 'advisory'")).rows[0].cantidad;
    assert.ok(advisory >= 1);
  });

  await scenario('la restricción única impide dos preparaciones para fecha/EDS', async () => {
    await consumo(); await precio(); await control(true);
    await db.exec('savepoint duplicado');
    await assert.rejects(db.query("insert into public.coseducam_preparaciones (fecha,codigo_eds,snapshot) values ($1::date,'40098','{}')", [fecha]), { code: '23505' });
    await db.exec('rollback to savepoint duplicado');
    assert.equal((await control(true)).estadoControl, 'PREPARADA');
    assert.deepEqual(await counts(), { preparaciones: 1, eventos: 2 });
  });
});
await db.close();
