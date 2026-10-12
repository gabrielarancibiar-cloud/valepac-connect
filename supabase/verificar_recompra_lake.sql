-- Verificación de la fase paralela Recompra Lake
select
  fecha,
  cantidad_operaciones,
  lineas,
  litros_base,
  monto_venta_referencia,
  actualizado_en
from public.recompra_resumen_diario
order by fecha;

select
  fecha,
  estado,
  cantidad_registros,
  ventas_elegibles,
  ventas_unicas,
  duplicadas,
  excluidas,
  coseducam_lineas,
  procesado_en
from public.recompra_estado_diario
order by fecha;

select
  fecha,
  count(*) as lineas,
  round(sum(litros)::numeric, 3) as litros
from public.coseducam_consumos
group by fecha
order by fecha;
