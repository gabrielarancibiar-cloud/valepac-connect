-- Base aislada de COSEDUCAM. No crea ni comparte tablas con VALEPAC Connect.
create extension if not exists pgcrypto;
create extension if not exists pg_cron;
create extension if not exists pg_net;

create table if not exists public.coseducam_jobs (
 id uuid primary key default gen_random_uuid(),
 fecha date not null,
 codigo_eds text not null default '40098' check(codigo_eds='40098'),
 estado text not null default 'pendiente' check (estado in ('pendiente','snapshot_listo','emitiendo','esperando_enruta','confirmando','confirmada','revision_requerida')),
 litros_calculados numeric(14,3), litros_guia integer, precio_aplicado integer,
 numero_guia text, codigo_autorizacion text, intentos_enruta integer not null default 0,
 proximo_intento timestamptz not null default now(),
 ultimo_error text, token_lease uuid, lease_hasta timestamptz,
 creado_en timestamptz not null default now(), actualizado_en timestamptz not null default now(),
 unique(fecha,codigo_eds)
);
create table if not exists public.coseducam_consumos (
 id bigint generated always as identity primary key,
 fecha date not null, codigo_eds text not null default '40098' check(codigo_eds='40098'),
 transaccion_id text not null, litros numeric(14,3) not null check(litros>0),
 hora_venta time not null check(hora_venta<'23:50:00'),
 unique(fecha,codigo_eds,transaccion_id)
);
create table if not exists public.coseducam_guias (
 id uuid primary key default gen_random_uuid(),
 fecha date not null, codigo_eds text not null default '40098' check(codigo_eds='40098'),
 rut_cliente text not null default '96.963.630-1', litros integer not null check(litros>0),
 estado text not null default 'emitiendo' check (estado in ('emitiendo','creada','confirmando','confirmada','revision_requerida')),
 numero_guia text, codigo_autorizacion text, creado_en timestamptz not null default now(), confirmada_en timestamptz,
 unique(fecha,codigo_eds)
);
create table if not exists public.coseducam_eventos (
 id bigint generated always as identity primary key,
 fecha date, etapa text not null, mensaje text not null,
 creado_en timestamptz not null default now()
);
create index if not exists jobs_pendientes on public.coseducam_jobs (proximo_intento) where estado in ('pendiente','snapshot_listo','esperando_enruta');

alter table public.coseducam_jobs enable row level security;
alter table public.coseducam_consumos enable row level security;
alter table public.coseducam_guias enable row level security;
alter table public.coseducam_eventos enable row level security;
revoke all on public.coseducam_jobs,public.coseducam_consumos,public.coseducam_guias,public.coseducam_eventos from anon,authenticated;
-- Solo servicio backend, nunca anon ni authenticated.

-- Transaccion atomica: planifica exclusivamente el dia chileno desde 23:50, luego toma 1 trabajo con lease.
create or replace function public.coseducam_tomar_trabajo()
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_fecha date; v_hora time; v public.coseducam_jobs%rowtype; v_token uuid := gen_random_uuid();
begin
 v_fecha := (now() at time zone 'America/Santiago')::date;
 v_hora := (now() at time zone 'America/Santiago')::time;
 if v_hora >= '23:50:00'::time and v_hora < '23:59:59.999999'::time then
  insert into public.coseducam_jobs(fecha,codigo_eds) values(v_fecha,'40098') on conflict do nothing;
 end if;
 select * into v from public.coseducam_jobs
 where estado in ('pendiente','snapshot_listo','esperando_enruta') and proximo_intento <= now()
   and (lease_hasta is null or lease_hasta < now())
 order by fecha asc for update skip locked limit 1;
 if not found then return null; end if;
 update public.coseducam_jobs set token_lease=v_token,lease_hasta=now()+interval '2 minutes',actualizado_en=now() where id=v.id;
 return (to_jsonb(v) - 'token_lease' - 'lease_hasta') || jsonb_build_object('token_lease',v_token);
end $$;
revoke all on function public.coseducam_tomar_trabajo() from public,anon,authenticated;
grant execute on function public.coseducam_tomar_trabajo() to service_role;

-- Snapshot atomico: inserta datos anteriores al corte y avanza job o nada.
create or replace function public.coseducam_guardar_snapshot(
 p_id uuid, p_lease uuid, p_consumos jsonb, p_litros numeric,
 p_litros_guia integer, p_precio integer
) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.coseducam_jobs%rowtype; filas integer;
begin
 select * into j from public.coseducam_jobs where id=p_id and estado='pendiente' and token_lease=p_lease for update;
 if not found then raise exception 'Job/lease no validos'; end if;
 if ((now() at time zone 'America/Santiago')::date <> j.fecha) then raise exception 'Snapshot despues del dia de corte bloqueado'; end if;
 if jsonb_typeof(p_consumos)<>'array' or jsonb_array_length(p_consumos)<1 or p_litros<=0 or p_litros_guia<=0 or p_precio<=0 then raise exception 'Snapshot invalido'; end if;
 insert into public.coseducam_consumos(fecha,codigo_eds,transaccion_id,litros,hora_venta)
 select j.fecha,j.codigo_eds,x.transaccion_id,x.litros,x.hora_venta
 from jsonb_to_recordset(p_consumos) as x(fecha text,codigo_eds text,transaccion_id text,litros numeric,hora_venta time);
 get diagnostics filas=row_count;
 if filas <> jsonb_array_length(p_consumos) then raise exception 'Numero de ventas distinto'; end if;
 if (select abs(sum(litros)-p_litros)>0.001 from public.coseducam_consumos where fecha=j.fecha and codigo_eds=j.codigo_eds) then raise exception 'Litros de snapshot no concuerdan'; end if;
 update public.coseducam_jobs set estado='snapshot_listo',litros_calculados=p_litros,litros_guia=p_litros_guia,
  precio_aplicado=p_precio, token_lease=null,lease_hasta=null,ultimo_error=null,proximo_intento=now(),actualizado_en=now()
 where id=j.id;
 return true;
end $$;
revoke all on function public.coseducam_guardar_snapshot(uuid,uuid,jsonb,numeric,integer,integer) from public,anon,authenticated;
grant execute on function public.coseducam_guardar_snapshot(uuid,uuid,jsonb,numeric,integer,integer) to service_role;
