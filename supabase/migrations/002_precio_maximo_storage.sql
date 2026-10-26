-- COSEDUCAM Autonomo v0.3 - Solo modifica el esquema local y la RPC del snapshot.
-- Ejecutar UNA VEZ en el Supabase NUEVO. No invoca TAE, En Ruta ni CopecFuel.
-- Guarda el precio unitario de cada carga real STORAGE y exige que el precio
-- de la guia sea el MAXIMO entre esas MISMAS cargas, antes de las 23:50.
begin;

alter table public.coseducam_consumos
  add column if not exists precio_unitario integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.coseducam_consumos'::regclass
      and conname = 'coseducam_consumos_precio_positivo'
  ) then
    alter table public.coseducam_consumos
      add constraint coseducam_consumos_precio_positivo
      check (precio_unitario is null or precio_unitario > 0);
  end if;
end $$;

create or replace function public.coseducam_guardar_snapshot(
 p_id uuid, p_lease uuid, p_consumos jsonb, p_litros numeric,
 p_litros_guia integer, p_precio integer
) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare
 j public.coseducam_jobs%rowtype;
 filas integer;
 v_litros numeric;
 v_precio_max integer;
begin
 select * into j from public.coseducam_jobs
 where id=p_id and estado='pendiente' and token_lease=p_lease for update;
 if not found then raise exception 'Job/lease no validos'; end if;
 if ((now() at time zone 'America/Santiago')::date <> j.fecha)
   then raise exception 'Snapshot despues del dia de corte bloqueado'; end if;
 if jsonb_typeof(p_consumos) is distinct from 'array'
   then raise exception 'Snapshot sin arreglo de consumos'; end if;
 if jsonb_array_length(p_consumos) < 1
   or p_litros is null or p_litros <= 0
   or p_litros_guia is null or p_litros_guia <= 0
   or p_precio is null or p_precio <= 0
   then raise exception 'Snapshot invalido'; end if;

 -- Ni la hora posterior al corte ni sus datos se guardan siquiera en esta tabla.
 -- Tampoco se aceptan precios faltantes ni un precio tomado de otra fuente.
 if exists (
   select 1 from jsonb_to_recordset(p_consumos) as x(
     fecha date,codigo_eds text,transaccion_id text,litros numeric,
     hora_venta time,precio_unitario integer)
   where x.fecha is distinct from j.fecha
      or x.codigo_eds is distinct from j.codigo_eds
      or nullif(btrim(x.transaccion_id),'') is null
      or x.litros is null or x.litros <= 0
      or x.litros <> round(x.litros,3)
      or x.hora_venta is null or x.hora_venta >= '23:50:00'::time
      or x.precio_unitario is null or x.precio_unitario <= 0
 ) then
   raise exception 'Consumos, precio, EDS u hora de corte invalidos';
 end if;

 select sum(x.litros), max(x.precio_unitario) into v_litros,v_precio_max
 from jsonb_to_recordset(p_consumos) as x(litros numeric,precio_unitario integer);
 if v_litros is distinct from p_litros
    or v_precio_max is distinct from p_precio
    or floor(v_litros + 0.5)::integer is distinct from p_litros_guia
 then
   raise exception 'Totales/valor maximo STORAGE no concuerdan con las cargas';
 end if;

 insert into public.coseducam_consumos
   (fecha,codigo_eds,transaccion_id,litros,hora_venta,precio_unitario)
 select x.fecha,x.codigo_eds,x.transaccion_id,x.litros,
        x.hora_venta,x.precio_unitario
 from jsonb_to_recordset(p_consumos) as x(
    fecha date,codigo_eds text,transaccion_id text,litros numeric,
    hora_venta time,precio_unitario integer);
 get diagnostics filas=row_count;
 if filas <> jsonb_array_length(p_consumos)
   then raise exception 'Numero de consumos distinto'; end if;

 -- Se excluye cualquier fila antigua/incompleta para impedir emitir con
 -- un conjunto persistido que no sea igual al snapshot aprobado.
 if (select count(*) from public.coseducam_consumos
     where fecha=j.fecha and codigo_eds=j.codigo_eds) <> filas
    or (select sum(litros) from public.coseducam_consumos
        where fecha=j.fecha and codigo_eds=j.codigo_eds) is distinct from p_litros
    or (select max(precio_unitario) from public.coseducam_consumos
        where fecha=j.fecha and codigo_eds=j.codigo_eds) is distinct from p_precio
 then
   raise exception 'Snapshot persistido no concuerda: revision requerida';
 end if;

 update public.coseducam_jobs
 set estado='snapshot_listo',litros_calculados=p_litros,
     litros_guia=p_litros_guia,precio_aplicado=p_precio,
     token_lease=null,lease_hasta=null,ultimo_error=null,
     proximo_intento=now(),actualizado_en=now()
 where id=j.id;
 return true;
end $$;

revoke all on function public.coseducam_guardar_snapshot(uuid,uuid,jsonb,numeric,integer,integer)
 from public,anon,authenticated;
grant execute on function public.coseducam_guardar_snapshot(uuid,uuid,jsonb,numeric,integer,integer)
 to service_role;

commit;
