# VALEPAC Connect: PWA COSEDUCAM — actualización de CopecFuel a Data Lake

## Qué cambia
- Se mantiene «Consultar Data Lake»: lectura inmediata de PostgreSQL, SIN descarga.
- Se agrega «Actualizar desde CopecFuel»: solo día Chile actual (>=15-10-2026), usuario COSEDUCAM autenticado o worker autorizado. Invoca la captura real del Data Lake y el proceso M2+Recompra+COSEDUCAM existente, ahora con comprobación de SHA-256 y estado en PostgreSQL.
- Se muestra hora de última captura y último procesamiento en la PWA.
- El panel COSEDUCAM del portal principal usa «Actualizar hoy desde CopecFuel» en lugar de reprocesar el mes desde ese módulo.
- Con preparación, job o guía existentes no actualiza la fecha; ninguna función emite TAE ni confirma En Ruta.

## Instalación
1. Desplegar primero el ZIP de Data Lake. Es requisito para las nuevas respuestas `sha256`, `capturadoEn`, `procesadoEn`.
2. En el repositorio `valepac-connect`, reemplazar únicamente los archivos que contiene el ZIP de parche, manteniendo sus rutas relativas.
3. Desplegar Vercel y revisar build. El Service Worker se actualiza a caché v3 para que el celular renueve la PWA sin eliminar caches de otros módulos.
4. En una fecha operativa actual sin job/guía, pulsar «Actualizar desde CopecFuel». Esperar la descarga y procesamiento; luego comprobar en SQL (`recompra_estado_diario`, `coseducam_consumos`) que `capturado_en` y `procesado_en` cambiaron, `coseducam_lineas` coincide y el precio MAX es correcto.
5. Probar «Consultar Data Lake» y confirmar que NO cambia `capturado_en`. No activar todavía cron ni las variables `COSEDUCAM_TAE_V2_HABILITADA` / `COSEDUCAM_ENRUTA_V2_HABILITADA`.

## Seguridad
La PWA no conoce `DATA_LAKE_INTERNAL_TOKEN`, `COPEC_FUEL_VENTAS_TOKEN` ni otros secretos. El backend de VALEPAC Connect usa los secretos ya configurados en Vercel. Un refresco fallido bloquea emisión.

## Verificación Supabase (solo lectura)
```sql
select fecha, estado, coseducam_lineas, sha256,
       capturado_en at time zone 'America/Santiago' as capturado_chile,
       procesado_en at time zone 'America/Santiago' as procesado_chile
from public.recompra_estado_diario
where fecha = (now() at time zone 'America/Santiago')::date;
```

## Alcance
No activa emisión TAE, En Ruta ni cron. `coseducam-worker` desplegado previamente sigue siendo diagnóstico hasta nueva integración. No afecta guías históricas por operación voluntaria: ese día no se puede refrescar si está preparado o tiene job/guía.
