# Recompra Lake — producción

Recompra usa `recompra_resumen_diario` como única fuente del detalle de combustible.
Coseducam usa `coseducam_consumos`. El RAW diario continúa en Storage y sirve también a M2.

No existe fallback ni escritura a `recompra_ventas`.

Orden de despliegue:
1. Ejecutar `supabase/recompra_lake_produccion.sql` en VALEPAC Connect.
2. Desplegar Data Lake productivo.
3. Desplegar VALEPAC Connect productivo.
4. Sincronizar desde 01-10-2026 para reescribir JSONB en formato nativo y confirmar pantalla.
5. Ejecutar `supabase/verificar_recompra_lake_produccion.sql`.
6. Probar Recompra y Coseducam.
7. Ejecutar `supabase/cleanup_recompra_legacy.sql`.

El DROP no usa CASCADE. Si PostgreSQL detecta una dependencia, se debe revisar antes de borrar nada adicional.
