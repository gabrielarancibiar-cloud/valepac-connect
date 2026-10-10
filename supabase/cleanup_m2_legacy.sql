-- VALEPAC Connect · retiro definitivo del detalle M2 antiguo
-- EJECUTAR SOLO DESPUÉS de:
-- 1) crear m2_resumen_diario / m2_estado_diario,
-- 2) desplegar Data Lake y VALEPAC Connect nuevos,
-- 3) sincronizar el mes,
-- 4) verificar que M2 carga correctamente desde las tablas resumen.
--
-- m2_bluemax_costos NO se elimina: ahora forma parte del modelo M2 Lake operacional.

begin;

drop table if exists public.m2_ventas cascade;

commit;

select
  to_regclass('public.m2_ventas') as m2_ventas_debe_ser_null,
  to_regclass('public.m2_resumen_diario') as m2_resumen_diario,
  to_regclass('public.m2_estado_diario') as m2_estado_diario,
  to_regclass('public.m2_bluemax_costos') as m2_bluemax_costos;

select pg_size_pretty(pg_database_size(current_database())) as database_size;
