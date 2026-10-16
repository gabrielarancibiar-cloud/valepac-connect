-- Solo lectura. Ejecutar antes de la migración y conservar resultados.
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name in (
  'coseducam_jobs', 'coseducam_guias', 'coseducam_consumos',
  'copecfuel_resumenes', 'recompra_estado_diario'
)
order by table_name, ordinal_position;

-- Job 1 debe seguir active=false. No modifica Job 2 ni su programación.
select jobid, jobname, active, schedule
from cron.job where jobid in (1, 2) order by jobid;

select (now() at time zone 'America/Santiago') as hora_chile,
       to_regprocedure('public.coseducam_preparar_v1(date,boolean)') as rpc_instalada;

select fecha, codigo_eds, producto, count(*) as lineas, sum(litros) as litros
from public.coseducam_consumos
where fecha >= date '2026-10-15'
  and fecha <= (now() at time zone 'America/Santiago')::date
group by fecha, codigo_eds, producto
order by fecha, codigo_eds, producto;
