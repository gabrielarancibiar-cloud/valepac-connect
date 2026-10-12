# Recompra Lake — fase paralela

Esta fase **no elimina `recompra_ventas`** y no cambia todavía la fuente productiva de la pantalla Recompra.
El objetivo es demostrar igualdad entre la lógica actual y la lógica reconstruida desde el JSON diario `VENTA_COMBUSTIBLE` que ya está archivado.

## Arquitectura durante la prueba

```text
CopecFuel VENTA_COMBUSTIBLE
        ├─→ recompra_ventas (actual, temporal)
        └─→ JSON.gz Data Lake
                ↓
          recompra_resumen_diario
          recompra_estado_diario
          coseducam_consumos
                ↓
          comparación 1:1
```

Los abonos Recompra, precios costo, Volumen Propio, fluctuaciones y TCT/TAE manual siguen siendo las mismas tablas operativas actuales. Por eso la comparación prueba exactamente el cambio que queremos hacer: reemplazar solo el detalle pesado de `recompra_ventas`.

## 1. Supabase VALEPAC Connect

Ejecutar:

`supabase/recompra_lake_paralelo.sql`

Crea:
- `recompra_resumen_diario`
- `recompra_estado_diario`
- `coseducam_consumos`

No borra nada.

## 2. Desplegar Data Lake

Subir el repositorio Data Lake incluido en esta entrega.
No requiere variables nuevas: utiliza las mismas variables que ya usa M2.

`/api/process` ahora procesa dos resultados desde el mismo JSON:
- M2
- Recompra Lake + subconjunto Coseducam

Si Recompra Lake falla, M2 sigue funcionando y el error se devuelve explícitamente.

## 3. Desplegar VALEPAC Connect

Subir el repositorio VALEPAC Connect incluido en esta entrega.

En Recompra aparecerá el panel **Validación Recompra Lake**.
La pantalla productiva sigue leyendo `recompra_ventas` durante esta fase.

## 4. Cargar el paralelo

En Recompra seleccionar el inicio del mes y usar **Sincronizar desde fecha**.
Cada día hará:

1. sincronización Recompra antigua;
2. actualización del JSON.gz;
3. procesamiento Recompra Lake;
4. actualización de Coseducam Lake;
5. Volumen Propio / abonos / precios / fluctuaciones como hasta ahora.

## 5. Resultado esperado

Para cada día cerrado:
- diferencia de litros = 0;
- diferencia monetaria = $0;
- campos distintos = 0;
- Coseducam paralelo = OK.

El día actual puede aparecer **EN CURSO** si entraron transacciones entre la consulta productiva y la captura del JSON.

## 6. Verificación SQL

Ejecutar `supabase/verificar_recompra_lake.sql` para revisar los días procesados y el subconjunto Coseducam.

## 7. No borrar todavía

No ejecutar ningún `DROP TABLE recompra_ventas` en esta fase.
Cuando tengamos varios días cerrados en 0 / $0 se prepara la fase final:

- Recompra pasa a leer `recompra_resumen_diario`;
- Coseducam pasa a leer `coseducam_consumos`;
- creación de guías Coseducam usa `coseducam_consumos`;
- se detiene la escritura en `recompra_ventas`;
- recién entonces se elimina `recompra_ventas`.
