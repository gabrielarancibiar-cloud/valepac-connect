# Fix EE.RR Productos - Vigente Mes

## Objetivo
Acotar la carga de costos a los productos que realmente afectan el EE.RR. del mes seleccionado.

## Lógica
- `Vigente Mes = Sí`: el producto registra ventas dentro del mes seleccionado.
- `Costo faltante Mes = Sí`: al menos una línea vendida en ese mes no encuentra un costo vigente para la fecha de la venta.
- Productos históricos sin ventas en el mes dejan de aparecer en la vista prioritaria.
- No se elimina historial ni catálogo.

## Interfaz
El Administrador de costos abre por defecto en `Pendientes mes` y permite alternar entre:
1. Pendientes mes
2. Vigente Mes
3. Todos

Se agregó la columna `Vigente Mes` en la tabla.

## Excel
La plantilla exportada incluye:
- Vigente Mes
- Costo faltante Mes
- Líneas sin costo Mes

La exportación usa la vista actual para permitir trabajar solamente con los faltantes del mes.

## Vigencia sugerida
Para un EE.RR. histórico, el campo `Vigente desde` propone el primer día del mes seleccionado. Ejemplo: septiembre 2026 -> 2026-09-01.

## Base de datos
No requiere migración SQL.
