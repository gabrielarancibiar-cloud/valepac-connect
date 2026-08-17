# PWA móvil Coseducam

Esta entrega agrega una segunda aplicación móvil al proyecto sin reemplazar el portal principal.

## Archivos para GitHub

Sube todos los archivos del paquete conservando exactamente sus carpetas:

- `api/_lib/supabaseAdmin.js`
- `api/conciliacion/muevo-empresa.js`
- `coseducam-pwa/index.html`
- `public/coseducam-manifest.webmanifest`
- `public/coseducam-pwa/sw.js`
- `public/icons/valepac-coseducam.svg`
- `public/icons/valepac-coseducam-192.png`
- `public/icons/valepac-coseducam-512.png`
- `src/components/AdminGate.jsx`
- `src/lib/api.js`
- `src/services/coseducamApi.js`
- `src/coseducam-pwa/main.jsx`
- `src/coseducam-pwa/CoseducamPwa.jsx`
- `src/coseducam-pwa/styles.css`
- `vite.config.js`

No requiere ejecutar SQL. Agrega en Vercel la variable:

`VALEPAC_COSEDUCAM_EMAILS=mleon@valepac.cl`

Para autorizar varias cuentas, sepÃ¡ralas con comas. Esta lista habilita solamente
las funciones de Coseducam; no entrega acceso administrativo al portal completo.

La cuenta tambiÃ©n debe existir en `Supabase > Authentication > Users`, con correo
confirmado y una contraseÃ±a definida. DespuÃ©s de guardar la variable en Vercel,
realiza un nuevo despliegue para que quede aplicada.

## Dirección

Después del despliegue estará disponible en:

`https://valepac-connect.vercel.app/coseducam-pwa/`

El portal principal continuará disponible en la dirección actual.

## Funciones

1. Inicio de sesión con una cuenta administrativa o una cuenta operativa incluida
   en `VALEPAC_COSEDUCAM_EMAILS`.
2. Fecha del día seleccionada por defecto.
3. `Importar litros`: sincroniza solamente el día seleccionado desde la API oficial CopecFuel y muestra los litros STORAGE de Coseducam.
4. `Crear TAE`: utiliza los litros encontrados y obliga a usar el precio diésel observado. Si Portal TCT/TAE propone otro precio, pide confirmación antes de reemplazarlo.
5. `Confirmar EnRuta`: valida y confirma la guía registrada utilizando el flujo existente.
6. Historial mensual de litros, precio, número de guía y estado.
7. Instalación como aplicación y lectura del historial ya cargado cuando el dispositivo quede sin conexión. Las operaciones productivas requieren conexión.

## Instalar en el teléfono

### Android

Abre la dirección en Chrome y usa el botón `Instalar` cuando aparezca, o el menú de Chrome `Instalar aplicación`.

### iPhone

Abre la dirección en Safari, pulsa `Compartir` y luego `Agregar a inicio`.

## Primera prueba recomendada

Usa una fecha que todavía no tenga guía:

1. Inicia sesión.
2. Revisa la fecha.
3. Pulsa `Importar litros`.
4. Confirma que litros y precio observado sean correctos.
5. Pulsa `Crear TAE` y acepta la confirmación.
6. Revisa número y mensaje de guía creada.
7. Pulsa `Confirmar EnRuta` y valida el resultado final.
