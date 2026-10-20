# COSEDUCAM — Migración de botones PWA al motor V2

**Estado de esta entrega:** parche de integración, **SIN habilitar emisiones reales**. Fecha: 20-10-2026.

## Objetivo

La PWA (`/coseducam-pwa/`), el panel del portal principal y el futuro worker automático utilizarán las **mismas rutas servidor**. Se elimina de la interfaz la moda general del diésel: las cifras provienen del precio máximo unitario STORAGE de `public.coseducam_consumos`, solo operaciones elegibles de 00:00:00 a 23:49:59 (fecha/hora oficial CopecFuel). Las cargas 23:50:00–23:59:59 quedan fuera de la emisión automática. Las fechas anteriores al 15-10-2026 son solo consulta.

## Arquitectura

Todas las rutas V2 son `POST /api/conciliacion/muevo-empresa`, con actor autenticado de la PWA (Bearer Supabase) o del futuro worker (`x-valepac-worker-secret`). No se distribuyen secretos a React.

| Acción | Descripción | Por defecto |
|---|---|---|
| `coseducam_v2_consultar` | Leer Data Lake + contrastar resumen SQL `coseducam_resumen_comercial_v2` cuando aplique; **no sincroniza ni escribe** | Disponible |
| `coseducam_v2_crear_tae` | `preparar_v2` → `reservar_tae_v2` → `iniciar_tae_v2` → **un POST TAE** → `registrar_tae_v2` | **Bloqueada** |
| `coseducam_v2_confirmar_enruta` | Reclamar un único intento del job `esperando_enruta` → validar pedido y autorizar en En Ruta → reflejar estado de job | **Bloqueada** |

Las acciones antiguas `crear_guia_coseducam` y `confirmar_guia_coseducam` responden **HTTP 410** para evitar que dispositivos con PWA desactualizada usen otro emisor. El motor antiguo sigue en el archivo como referencia y para reutilizar exclusivamente las rutinas seguras de lectura/confirmación bajo el nuevo claim.

**Importante:** `Consultar Data Lake` ha reemplazado al botón `Importar litros` de la PWA: ahora solo lee la base que alimenta Data Lake. **No realiza una sincronización CopecFuel ni archiva JSON.** La sincronización final posterior a las 23:50 está pendiente de su orquestación en Data Lake.

## Flags de seguridad — NO habilitar todavía

En Vercel, si estas variables no existen o no valen exactamente `true`, las llamadas externas están bloqueadas:

- `COSEDUCAM_TAE_V2_HABILITADA`
- `COSEDUCAM_ENRUTA_V2_HABILITADA`

**No crear estas variables con valor `true`.** El código ha pasado pruebas estáticas y de cálculo, pero no pruebas reales de TAE/En Ruta ni auditoría de cierre contra el origen CopecFuel. La Edge Function `coseducam-worker` instalada sigue en modo diagnóstico: esta entrega **no activa cron ni inicia emisiones automáticas**.

## Despliegue recomendado

1. Hacer copia de la rama principal en GitHub y conservar el ZIP original.
2. Subir únicamente los archivos del ZIP de parche a sus rutas exactas, sin eliminar carpetas del repositorio.
3. Confirmar que ambas flags estén ausentes o no sean `true` en Vercel. No modificar `COSEDUCAM_WORKER_SECRET`, JWT, RLS, M2 ni Recompra.
4. Desplegar en Vercel y comprobar el build. Esta entrega fue revisada sintácticamente, pero **no se pudo ejecutar Vite build** en el entorno de creación por falta de dependencias y acceso al registro npm.
5. Recargar la PWA cerrando y abriendo la pestaña; el Service Worker actualizó su identificador de caché a `valepac-coseducam-v2`.
6. Consultar el 14-10-2026: debe mostrar 9 registros, 3.207,55 L y $1.497/L si Data Lake mantiene esos valores; sin opción de emisión histórica.
7. Consultar la fecha de hoy antes de las 23:50: la creación debe verse bloqueada y no debe existir guía nueva.
8. Verificar que las acciones legacy ya no emitan: responden HTTP 410. **Nunca probar generando guías ficticias.**

## Pruebas locales realizadas

`node --test server/coseducam/comercialV2.test.js` — **7/7 superadas**: corte 23:50, máximo precio, histórico, precio incompleto, fecha/hora faltante, timestamp Copec desajustado, duplicados y bloqueo horario/flags (7 grupos).

`node --check api/conciliacion/muevo-empresa.js` — sin errores de sintaxis.

Se analizaron sintácticamente con TypeScript las dos interfaces `src/App.jsx` y `src/coseducam-pwa/CoseducamPwa.jsx` — sin errores de sintaxis JSX.

**No se realizaron llamadas a Copec ni cambios en Supabase de producción.**

## Pendiente antes de habilitar emisión real

- Revalidar la integridad del cierre de CopecFuel, sincronización Data Lake *después* de las 23:50 y que el estado PROCESADO incluya el intervalo completo permitido.
- Revisar en entorno de pruebas las RPC V2 con preparación y reserva reales, sin llamadas externas; comprobar permisos y comportamiento ante carreras.
- Validar contrato exacto de `/autorizar-consumo` y credenciales antes de activar el flag TAE. La función externa llama una sola vez; ante ambigüedad marca revisión requerida.
- Validar el claim de En Ruta, formato de respuesta del monitor de entrega y bloqueo de reintentos en incidentes.
- Preparar/activar orquestación del worker que llame las mismas acciones V2; el worker Edge ya desplegado solo diagnostica.
- Revisar efecto administrativo y tributario de guías, y aprobar explícitamente el pase a producción.

Las regularizaciones entre las 23:50 y las 23:59 no son parte de este código; se resuelven directamente por Administración en el portal TAE de Copec.
