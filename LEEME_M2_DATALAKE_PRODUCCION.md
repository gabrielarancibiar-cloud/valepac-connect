# VALEPAC Connect · M2 Lake integrado

## Arquitectura final

- **Supabase VALEPAC Connect**: tablas operativas livianas `m2_resumen_diario`, `m2_estado_diario` y `m2_bluemax_costos`.
- **Supabase Data Lake**: `raw_archivos` + bucket privado `valepac-raw` con los JSON diarios `.json.gz`.
- **VALEPAC Data Lake (Vercel)**: consulta CopecFuel, archiva el JSON y procesa el M2; escribe el resumen directamente en PostgreSQL de VALEPAC Connect mediante `SOURCE_DATABASE_URL`.
- **VALEPAC Connect (Vercel)**: lee M2 únicamente desde su propio Supabase.

Las cuentas Gmail de ambos proyectos Supabase pueden ser distintas. La integración es servidor a servidor y no depende de que tengan el mismo propietario.

## Variables en VALEPAC Connect

Se mantienen las variables normales de su propio Supabase y, para pedir al servicio Data Lake que archive/procese días:

- `DATA_LAKE_APP_URL`
- `DATA_LAKE_INTERNAL_TOKEN`

Ya **no** se requieren en VALEPAC Connect:

- `DATA_LAKE_SUPABASE_URL`
- `DATA_LAKE_SUPABASE_SECRET_KEY`

## Variables en VALEPAC Data Lake

- `SUPABASE_URL` = Supabase Data Lake
- `SUPABASE_SERVICE_ROLE_KEY` = Supabase Data Lake
- `SOURCE_DATABASE_URL` = conexión PostgreSQL del Supabase VALEPAC Connect (Shared Pooler)
- `COPEC_FUEL_VENTAS_TOKEN`
- `COPEC_FUEL_CLIENTE_ID`
- `COPECFUEL_API_URL=https://api2pr.copecfuel.com`
- `DATA_LAKE_INTERNAL_TOKEN` = mismo valor de VALEPAC Connect

## Orden de instalación

1. En Supabase VALEPAC Connect ejecutar `supabase/m2_lake_operacional.sql`.
2. En Supabase Data Lake ejecutar `supabase/setup.sql` del repositorio Data Lake nuevo.
3. Desplegar primero VALEPAC Data Lake.
4. Desplegar VALEPAC Connect.
5. En M2, ejecutar `Sincronizar M2` para reconstruir el mes en las tablas nuevas de VALEPAC Connect.
6. Verificar cifras.
7. Ejecutar `supabase/cleanup_m2_legacy.sql` en Supabase VALEPAC Connect para borrar `m2_ventas`.
8. Opcionalmente ejecutar `supabase/cleanup_m2_operacional_data_lake.sql` en Supabase Data Lake para eliminar las copias de prueba antiguas de resumen/costos.

`m2_bluemax_costos` NO se elimina de VALEPAC Connect: forma parte de la arquitectura nueva.
