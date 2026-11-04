# VALEPAC Connect — revisión y fusión sobre repositorio vigente

Base exacta: archivo subido por el usuario `valepac-connect-main(2).zip` el 04-11-2026.

## Objetivo
Menú COSEDUCAM de **solo lectura**: litros CopecFuel STORAGE, precio máximo diario y conciliación con estados de guías en Copec En Ruta. No llama al motor TAE ni ejecuta `modificarPedido`.

No se añade una función Vercel: el plan Hobby mantiene **12 funciones**.

## No modificado
- API Octano y su enrutamiento en `vercel.json`.
- Endpoints y lógica M2, Recompra, POA, Productos, conciliación mensual, Data Lake.
- Backend V2 de emisión/confirmación y cron/worker: se conservan por compatibilidad; NO se activan ni se despliegan desde este paquete.
- `server/coseducam/preparation.js` de la versión vigente: se mantiene intacto.

## Lógica integrada
- `GET /api/conciliacion/muevo-empresa?tipo=coseducam&recurso=seguimiento_coseducam&periodo=AAAA-MM` requiere sesión COSEDUCAM autorizada.
- CopecFuel: `coseducam_consumos` del JSON Data Lake ya procesado (sin sincronizaciones nuevas).
- En Ruta: lectura de reporte `infoExcel`, sin hacer cambios externos.
- Redondeo del total diario a litros enteros, fracciones ≥0,5 suben.
- `RETIRO_TAE_OK` exige fecha original de autorización, cliente, producto, número de guía, estado de confirmación explícito y litros coincidentes.
- `FECHA ESTADO` no sustituye la fecha original del consumo.
- Estados `ENTREGADO/CERRADO` NO se consideran confirmación automática sin acreditar significado real.
- Se eliminan de interfaz principal y PWA la emisión, confirmación y actualización manual que vuelve a capturar CopecFuel.
- Service worker incrementado para renovar caché de la PWA.

## Modificaciones respecto del ZIP vigente

Archivos añadidos:
- `.gitignore`
- `COSEDUCAM_SEGUIMIENTO_SOLO_LECTURA_2026-11-04.md`
- `server/coseducam/seguimientoRead.js`
- `server/coseducam/seguimientoSoloLectura.js`
- `tests/coseducam-seguimiento-solo-lectura.test.mjs`

Archivos modificados:
- `api/conciliacion/muevo-empresa.js`
- `public/coseducam-pwa/sw.js`
- `src/App.jsx`
- `src/coseducam-pwa/CoseducamPwa.jsx`
- `src/services/coseducamApi.js`

## Advertencias de producción
- La fuente de información comercial es PostgreSQL con las filas CopecFuel almacenadas; no vuelve a descargar JSON en cada visita.
- En Ruta `infoExcel` requiere validar sus columnas y estados reales con datos de la EDS. Mientras no se confirme equivalencia, se mostrará "En Ruta no disponible" o "Revisión" y no un OK ficticio.
- El backend V2 sigue teniendo rutas de emisión/confirmación (sin uso desde el menú). Si se comprueba que ninguna otra app depende de estas rutas, se pueden desactivar por separado; comprobar flags en Vercel.
- No se ha desplegado en producción ni se han realizado solicitudes reales a En Ruta.
- El `index.ts` incluido en el ZIP vigente es de etapa de preparación y NO corresponde necesariamente a la Edge Function actualmente desplegada en Supabase. No sobrescribir el worker de Supabase con esta copia.
- Verificar cambios posteriores de GitHub antes de reemplazar el repositorio.
