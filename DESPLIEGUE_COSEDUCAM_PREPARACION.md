# COSEDUCAM: preparación automática sin emisión

Corte operativo: **15 de octubre de 2026**, EDS **40098**, calendario **America/Santiago**.

Esta etapa consulta los datos ya cargados, verifica guías y trabajos registrados en Supabase, y guarda una preparación con su evidencia. No consulta ni envía solicitudes a TAE o EnRuta. No sincroniza fuentes, no ejecuta Daily Sync y no programa cron.

Las preparaciones se guardan en **`coseducam_preparaciones`**, una tabla nueva que el Worker emisor antiguo no consume. **`coseducam_jobs` y `coseducam_guias` se consultan, pero no se modifican.** Cada intento explícito de preparar anexa auditoría en `coseducam_preparacion_eventos`, incluso si queda bloqueado o ya estaba preparado. El snapshot original no se sobrescribe.

## Archivos que se instalan

En el repositorio Vercel, reemplazar o agregar:

- `api/conciliacion/muevo-empresa.js`
- `server/coseducam/preparation.js`

La lógica compartida queda bajo `server/` y se importa desde el controlador existente; no se agrega un archivo de entrada en `api/`.

En Supabase:

- Ejecutar `supabase/migrations/20261015_coseducam_preparacion.sql`.
- Reemplazar **solo** el `index.ts` de **coseducam-worker** por `supabase/functions/coseducam-worker/index.ts`.

No reemplazar la Edge Function de Daily Sync ni sus archivos de control. No ejecutar otros SQL históricos incluidos en el repositorio.

## Orden de despliegue

1. Guardar copia del controlador y la Edge Function actualmente desplegados. Ejecutar `supabase/preflight_coseducam_preparacion.sql`, que solo lee. Conservar el resultado de cron: **Job 1 debe estar `active=false`**; Job 2 conserva exactamente su estado y programación existentes. Esta entrega no contiene comandos para activar ninguno.
2. Revisar que las tablas/columnas del preflight correspondan al repositorio. La migración requiere las fuentes existentes; no las crea ni las repara. El esquema de consumos está documentado en `supabase/recompra_lake_paralelo.sql`; el ZIP no incluye la definición completa de jobs/guías ni la aplicación externa de Data Lake. Una diferencia de esquema o permiso debe resolverse antes de continuar.
3. Ejecutar **únicamente** la migración nueva en SQL Editor como propietario. Es aditiva: crea tablas/RPC y restringe permisos. `anon` y `authenticated` no pueden invocarla. Vercel usa `service_role`; las claves permanecen en el servidor. Una excepción revierte la transacción.
4. Desplegar los dos archivos Vercel. Se conservan `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y `COSEDUCAM_WORKER_SECRET`. No poner secretos en variables `VITE_*`.
5. Desplegar la Edge Function nueva. Conservar estos secretos allí: `DAILY_SYNC_TEST_TOKEN` (al menos 16 caracteres), `COSEDUCAM_WORKER_SECRET` (al menos 16, idéntico a Vercel), `VALEPAC_API_URL=https://valepac-connect.vercel.app/api/conciliacion/muevo-empresa` o el mismo endpoint HTTPS de tu dominio Vercel. La URL debe ir sin parámetros, barra final ni credenciales.
6. El cliente de esta etapa se autentica mediante `x-daily-test-token`. Para llegar al handler sin JWT, configurar **solo `coseducam-worker`** con `verify_jwt=false`, o desplegar esa función con `supabase functions deploy coseducam-worker --no-verify-jwt`. El handler valida el token antes de consultar o preparar. No aplicar esa configuración a Daily Sync. Si la plataforma responde 401 sin `version` del Worker, el rechazo ocurrió antes de ejecutar el archivo; revisar la configuración por función. [Referencia oficial de cabeceras y verificación](https://supabase.com/docs/guides/functions/auth-headers).
7. Ejecutar primero simulación y control; después la preparación explícita de una fecha autorizada. Volver a consultar cron y comprobar que Job 1 sigue inactivo y Job 2 conserva su configuración. No habilitar Job 1 después de estas pruebas.

La llamada del cron antiguo, sin modo explícito, devuelve `simulacion_sin_operaciones`. Esta etapa no se ejecuta periódicamente por sí sola: la preparación automática de datos se invoca explícitamente por fecha; habilitar un horario queda fuera de esta entrega.

## Prueba manual

Desde la carpeta del repositorio, en PowerShell:

```powershell
.\scripts\probar-coseducam-preparacion.ps1 -Modo simulacion -Fecha 2026-10-15
.\scripts\probar-coseducam-preparacion.ps1 -Modo control -Fecha 2026-10-15
.\scripts\probar-coseducam-preparacion.ps1 -Modo preparar -Fecha 2026-10-15
.\scripts\probar-coseducam-preparacion.ps1 -Modo preparar -Fecha 2026-10-15
```

El script solicita el token con entrada oculta y nunca lo imprime. La segunda preparación debe conservar el mismo `preparacion.id`; agrega un evento de auditoría. Para otras fechas usar `-Fecha AAAA-MM-DD`, desde el corte hasta hoy en Chile. No se aceptan EDS alternativas, litros/precios aportados por el cliente ni banderas de emisión.

La Edge Function también admite `modo=diagnostico`, equivalente a una lectura segura del control. El cuerpo operativo es `{}`. Sin modo, o con `modo=simulacion`, no realiza operaciones.

## Interpretación de resultados

`ok=true` significa que se completó la evaluación. **Solo `estadoControl=PREPARADA` y `preparado=true` indican una preparación guardada.** `modificoDatos=true` en modo preparar puede significar únicamente que se anexó el evento de auditoría.

| Estado | Resultado |
| --- | --- |
| `LISTA_PARA_PREPARAR` | Control de lectura válido, aún no guarda preparación. |
| `PREPARADA` | Snapshot aislado guardado o recuperado por idempotencia. No autoriza emisión. |
| `ESPERANDO_CONSUMO` | No hay consumos acreditados para preparar. La ausencia de filas no demuestra un día completo sin consumo. |
| `ESPERANDO_PRECIO` | Falta un precio observado válido de esa fecha/EDS o existe evidencia ambigua. |
| `BLOQUEADA_REVISION` | Guía existente, trabajo inseguro, duplicados o consumos inválidos. |
| `DATOS_CAMBIARON` | Los datos de negocio difieren del snapshot original. Se preserva para revisión; no se reemplaza automáticamente. |

Siempre deben verse `emisionHabilitada=false` y `confirmacionHabilitada=false`. Un error de consulta nunca se interpreta como inexistencia de guía o cero consumo. Si se pierde la respuesta de una preparación, su resultado es desconocido; consultar control y repetir la misma fecha conserva idempotencia.

El precio es la moda diaria ya calculada por `server/copecfuel/reporteVentas.js`: ventas diésel ASISTIDO con litros y total positivos. Se exige la captura oficial más reciente de **ese mismo día y EDS**; no se sustituye por precio de costo, precio vigente, otra estación, otro día o una captura anterior válida cuando la nueva es inválida. Se guardan procedencia y hora de sincronización. La preparación es un **snapshot provisional**: esta etapa no certifica precio del portal TAE, completitud de las fuentes ni cierre definitivo del día. Un cambio material posterior devuelve `DATOS_CAMBIARON` y conserva el snapshot para revisión.

La RPC puede mantener bloqueos compartidos breves sobre las fuentes durante el guardado. Eso puede hacer esperar una escritura concurrente hasta el commit; no invoca ni condiciona la secuencia de Daily Sync. El límite de espera de bloqueo evita quedar esperando indefinidamente.

## Reversión y alcance

Para detener las pruebas, dejar de invocar modo preparar y mantener Job 1 inactivo. No restaurar el Worker emisor antiguo como mecanismo de reversión: contiene rutas de emisión que esta etapa elimina. Se puede conservar la nueva función en simulación/control y las tablas de auditoría. Ninguna preparación se convierte por sí sola en trabajo operacional.

Las funciones manuales existentes del portal conservan su autenticación humana. La credencial Worker queda limitada a control y preparación: ya no habilita emisión, confirmación ni sincronización en el controlador. No se ejecutó ninguna operación en producción durante la implementación local.

Consultar `VALIDACION_COSEDUCAM.md` para pruebas y límites de verificación. [Referencia oficial sobre funciones y permisos de base de datos](https://supabase.com/docs/guides/database/functions).
