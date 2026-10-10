# Paso a paso · M2 Lake integrado

## Resultado final

- Supabase **VALEPAC Connect**: `m2_resumen_diario`, `m2_estado_diario`, `m2_bluemax_costos`.
- Supabase **Data Lake**: `raw_archivos` + Storage `valepac-raw`.
- `m2_ventas` se elimina al final.

## 1. Supabase VALEPAC Connect

Abrir SQL Editor y ejecutar:

`supabase/m2_lake_operacional.sql`

No borra `m2_ventas`.

## 2. Supabase Data Lake

Usar el repositorio Data Lake que acompaña esta versión y ejecutar allí:

`supabase/setup.sql`

Ese SQL mantiene únicamente la capa de archivo crudo.

## 3. Vercel Data Lake

Confirmar variables:

- `SUPABASE_URL`: URL del Supabase Data Lake
- `SUPABASE_SERVICE_ROLE_KEY`: clave secreta del Supabase Data Lake
- `SOURCE_DATABASE_URL`: Shared Pooler del Supabase VALEPAC Connect
- `COPEC_FUEL_VENTAS_TOKEN`
- `COPEC_FUEL_CLIENTE_ID`
- `COPECFUEL_API_URL=https://api2pr.copecfuel.com`
- `DATA_LAKE_INTERNAL_TOKEN`

Desplegar Data Lake primero.

## 4. Vercel VALEPAC Connect

Mantener sus variables normales de Supabase y confirmar:

- `DATA_LAKE_APP_URL`: URL pública del proyecto Vercel Data Lake
- `DATA_LAKE_INTERNAL_TOKEN`: mismo valor del Data Lake

Estas variables ya no se usan y pueden eliminarse después del deploy:

- `DATA_LAKE_SUPABASE_URL`
- `DATA_LAKE_SUPABASE_SECRET_KEY`

Desplegar VALEPAC Connect.

## 5. Reconstruir M2

Entrar al módulo M2 y ejecutar **Sincronizar M2** para octubre.

El flujo será:

CopecFuel -> JSON.gz en Supabase Data Lake -> procesador -> `m2_resumen_diario` + `m2_estado_diario` en Supabase VALEPAC Connect.

## 6. Verificar antes de borrar

En Supabase VALEPAC Connect ejecutar:

`supabase/verificar_m2_lake.sql`

Debe mostrar días procesados y filas de resumen.

Abrir el portal y comprobar M2 total, productos y paneles.

## 7. Eliminar M2 antiguo

Solo después de verificar, ejecutar en Supabase VALEPAC Connect:

`supabase/cleanup_m2_legacy.sql`

Este script elimina únicamente `m2_ventas`. Conserva `m2_bluemax_costos`.

## 8. Limpiar las tablas de prueba del Data Lake

Después de comprobar que todo sigue funcionando, en Supabase Data Lake ejecutar:

`supabase/cleanup_m2_operacional_data_lake.sql`

Elimina las antiguas copias de `m2_resumen_diario` y `m2_bluemax_costos` del proyecto Data Lake. No toca `raw_archivos` ni los JSON comprimidos.
