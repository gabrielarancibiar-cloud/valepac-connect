# COSEDUCAM — Seguimiento de retiros TAE (VALEPAC Connect)

**Cambio de alcance, 04-11-2026:** Este menú NO crea autorizaciones TAE, NO confirma pedidos en En Ruta y NO altera los estados de guías. Las emisiones y confirmaciones se administran en una aplicación externa independiente.

## Fuentes del menú

1. `public.coseducam_consumos` — datos derivados del JSON CopecFuel archivado en Data Lake, con fecha, transacción, litros STORAGE DIESEL y precio unitario. El módulo lee registros; **no realiza una nueva captura JSON**.
2. Copec En Ruta — exportación de monitor de pedidos (`infoExcel`), consultada para obtener el estado de las guías. El módulo no llama a `modificarPedido`.

La API de seguimiento es `GET /api/conciliacion/muevo-empresa?tipo=coseducam&recurso=seguimiento_coseducam&periodo=2026-11` y requiere inicio de sesión COSEDUCAM o administrador autorizado.

## Conciliación

- EDS `40098`, cliente `96.963.630-1` (o razón social COSEDUCAM inequívoca), producto DIESEL.
- Litros comerciales calculados con el criterio del corte 23:50 de `clasificarConsumosV2`.
- Litros enteros esperados: precisión inicial a milésimas y redondeo matemático, 0,5 hacia arriba.
- Solo `RETIRO_TAE_OK` cuando coinciden **fecha original de autorización, identificador de guía, cliente, producto, litros y confirmación explícita** de En Ruta. Una coincidencia por litros sin fecha o cliente NO acredita retiro.
- `FECHA ESTADO` puede ser el día siguiente: NO se utiliza como sustituto de la fecha comercial.
- Estados genéricos `ENTREGADO` o `CERRADO` **no equivalen automáticamente** a confirmación TAE; hasta conocer la correspondencia oficial se informan como revisión.
- Si el reporte En Ruta no ofrece columnas suficientes, se informa `ENRUTA_NO_DISPONIBLE` y nunca se muestra un OK inferido.
- El cliente web y PWA únicamente consultan; los botones de crear y confirmar desaparecen. Las API V2 preexistentes se conservan por compatibilidad con posibles consumidores externos, pero no son llamadas desde las interfaces renovadas. **No se han deshabilitado del lado del servidor.**

## Precaución sobre dependencias externas

**Importante:** los endpoints V2 `coseducam_v2_crear_tae` y `coseducam_v2_confirmar_enruta` se conservan sin modificación, porque la otra aplicación podría utilizarlos. Si se confirma que no dependen de VALEPAC Connect, se pueden desactivar mediante un cambio posterior y controlado. La interfaz web y la PWA nuevas no disponen de botones, rutas ni servicios cliente para invocarlos.

El presente paquete no modifica la instancia desplegada de la Edge Function `coseducam-worker`, sus cron jobs ni sus secretos. No despliegues la copia histórica de `supabase/functions/coseducam-worker/index.ts` para administrar la nueva automatización separada.

## Validación pendiente en el proveedor

No se ha consultado En Ruta en producción desde esta versión. Se requieren encabezados y una fila real **anonimizada** del reporte `infoExcel` para verificar cuáles campos representan:
- número de guía TAE,
- fecha original de autorización,
- estado efectivo de confirmación,
- cliente/estación y litros entregados.

Hasta validar esas equivalencias, el módulo prefiere `Revisión` o `En Ruta no disponible` antes que un falso `Retiro TAE OK`.

## Instalación

1. Respaldar `main` antes de reemplazar archivos. Base de este ZIP: repositorio integrado entregado el 26-10-2026.
2. Publicar el proyecto en GitHub respetando carpetas. Vercel debe quedar `Ready`.
3. El menú *Coseducam* y la PWA de VALEPAC Connect son ahora de solo lectura.
4. Probar `GET /api/conciliacion/muevo-empresa?tipo=coseducam&recurso=seguimiento_coseducam&periodo=2026-11` con sesión administrativa.
5. Verificar datos comerciales versus el JSON CopecFuel y reportes de En Ruta. No activar emisión automática desde este repositorio.

## Pruebas locales

Ejecutar `node --test tests/coseducam-seguimiento-solo-lectura.test.mjs`.

Se aprobaron 16 pruebas unitarias simuladas de coincidencias, redondeo, diferencias, duplicados, estatus y protección contra falsos positivos. **No se completó build Vite**: las dependencias npm no están instaladas en el entorno utilizado y no estaban disponibles offline. La compatibilidad con los campos reales de En Ruta requiere validación.
