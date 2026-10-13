-- VALEPAC Connect · Recompra Lake · paso definitivo a producción
-- Ejecutar ANTES de eliminar recompra_ventas. Es idempotente.

-- Normaliza filas antiguas que durante la prueba quedaron como JSON-string
-- dentro de columnas jsonb. Los nuevos procesamientos ya guardan JSON real.
update public.recompra_estado_diario
set diagnostico = (diagnostico #>> '{}')::jsonb
where jsonb_typeof(diagnostico) = 'string';

update public.recompra_resumen_diario
set formas_pago = (formas_pago #>> '{}')::jsonb
where jsonb_typeof(formas_pago) = 'string';

update public.recompra_resumen_diario
set productos = (productos #>> '{}')::jsonb
where jsonb_typeof(productos) = 'string';

select
  count(*) as dias_resumen,
  min(fecha) as desde,
  max(fecha) as hasta,
  pg_size_pretty(pg_total_relation_size('public.recompra_resumen_diario')) as tamano_resumen,
  pg_size_pretty(pg_total_relation_size('public.coseducam_consumos')) as tamano_coseducam
from public.recompra_resumen_diario;
