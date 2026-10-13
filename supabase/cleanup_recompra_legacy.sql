-- ELIMINACIÓN DEFINITIVA DEL DETALLE LEGACY RECOMPRA
-- Ejecutar solo después de desplegar VALEPAC Connect + Data Lake productivos
-- y confirmar que Recompra/Coseducam cargan correctamente.

select pg_size_pretty(pg_total_relation_size('public.recompra_ventas')) as tamano_antes;

-- Intencionalmente SIN CASCADE. Si existe una dependencia, PostgreSQL se detendrá.
drop table if exists public.recompra_ventas;

select to_regclass('public.recompra_ventas') as recompra_ventas;
select pg_size_pretty(pg_database_size(current_database())) as tamano_base_despues;
