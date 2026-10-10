-- Verificación M2 Lake en Supabase VALEPAC Connect

select
  min(fecha) as desde,
  max(fecha) as hasta,
  count(*) as filas_resumen,
  round(sum(litros)::numeric, 2) as litros,
  round(sum(m2_neto)::numeric, 0) as m2_neto
from public.m2_resumen_diario;

select
  fecha,
  estado,
  cantidad_registros,
  filas_resumen,
  ventas_elegibles,
  ventas_unicas,
  duplicadas,
  sin_costo,
  pg_size_pretty(tamano_comprimido_bytes) as gzip,
  procesado_en
from public.m2_estado_diario
order by fecha desc
limit 31;

select
  codigo_eds,
  fecha_vigencia,
  precio_costo,
  observacion
from public.m2_bluemax_costos
order by fecha_vigencia desc;

select
  pg_size_pretty(pg_total_relation_size('public.m2_resumen_diario')) as tamano_resumen,
  pg_size_pretty(pg_total_relation_size('public.m2_estado_diario')) as tamano_estado,
  pg_size_pretty(pg_total_relation_size('public.m2_bluemax_costos')) as tamano_bluemax;
