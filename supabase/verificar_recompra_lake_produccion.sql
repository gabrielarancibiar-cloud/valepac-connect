-- Verificación previa al DROP de recompra_ventas
select
  fecha,
  cantidad_operaciones,
  lineas,
  litros_base,
  monto_venta_referencia,
  jsonb_typeof(formas_pago) as tipo_formas_pago,
  jsonb_typeof(productos) as tipo_productos
from public.recompra_resumen_diario
order by fecha desc
limit 20;

select
  fecha, estado, ventas_elegibles, ventas_unicas, duplicadas, coseducam_lineas,
  jsonb_typeof(diagnostico) as tipo_diagnostico,
  diagnostico ->> 'modo' as modo
from public.recompra_estado_diario
order by fecha desc
limit 20;

select fecha, count(*) as lineas, round(sum(litros)::numeric,3) as litros
from public.coseducam_consumos
group by fecha
order by fecha desc;
