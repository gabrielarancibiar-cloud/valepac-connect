# Validación local de COSEDUCAM sin emisión

Implementación preparada el 16-10-2026. No se desplegó ni se consultó producción.

## Base utilizada

- Repositorio: `valepac-connect-main (1).zip`, descargado el 15-10-2026; SHA-256 `f34dcadb2d26fd3f325f7cc1dd5be4a61300103d3e60f4579b63051f9933cd8e`.
- Control de etapa 1: `coseducam-control-etapa1.zip`, controlador y Edge de solo lectura. Se reemplazó el control de lectura por la RPC transaccional y se agregó preparación aislada.
- Worker anterior: `coseducam-worker.zip`, inspeccionado para recuperar contratos. Su emisor no se incorporó a la nueva Edge Function.
- Daily Sync: versión de referencia `2026-10-15.6-prueba-manual-controlada`, conservada sin cambios únicamente como fixture de pruebas.

Comparación por contenido con el ZIP del repositorio: **89 archivos originales idénticos**, un archivo original modificado (`api/conciliacion/muevo-empresa.js`), ningún original eliminado. No se alteraron `sources/` ni los archivos descargados. `comparacion-base.json` lista modificaciones y agregados; `SHA256.json` identifica los ZIP de entrega.

## Resultados

**66 resultados de pruebas aprobados**, más comprobaciones de tipos y sintaxis.

| Comprobación | Resultado |
| --- | --- |
| Edge: modo por defecto, autenticación, corte/calendario, parámetros, contrato, redirecciones y respuesta perdida | 10 pruebas aprobadas |
| Controlador real y helper: autorización, aislamiento de rutas, RPC, estados y snapshots | 15 pruebas aprobadas |
| SQL ejecutado en PostgreSQL embebido PGlite 0.5.10 | 37 resultados aprobados, incluida la suite principal |
| Recorrido Edge → controlador → RPC SQL real, con esquema de consumos del repositorio | 1 prueba aprobada |
| Daily Sync: CopecFuel y Portal completan su flujo tras fallar la preparación; rechaza módulos incompletos | 3 pruebas aprobadas |
| Edge TypeScript 7.0.2 en modo estricto, con tipos web y superficie mínima Deno usada | Aprobado |
| Sintaxis JavaScript del controlador/helper y análisis sintáctico del cliente PowerShell | Aprobado |
| Compilación general del portal con Vite | Pendiente: el entorno rechaza procesos auxiliares con `spawn EPERM` |

Las suites verifican el corte del 15-10-2026 y fechas posteriores elegibles, rechazan fechas previas y futuras, consultan el precio de la misma fecha/EDS y nunca retroceden a una captura anterior válida si la última es inválida. También cubren conflictos entre todas las capturas empatadas, errores de lectura, guías y jobs inseguros/duplicados, datos malformados, pérdida de respuesta, conservación de snapshots, permisos/RLS y reversión del guardado cuando falla su auditoría.

La preparación escribe solo tablas aisladas; los tests comprueban que no crea jobs operacionales ni guías. La Edge no contiene llamadas de emisión, confirmación, sincronización o programación. El controlador bloquea esas rutas para la credencial Worker antes de la autenticación humana. Las rutas manuales del portal conservan su acceso humano existente.

Los archivos `_lib/dailyControl.js`, `api/_lib/dailyControl.js`, `api/copecfuel/sincronizar.js`, `api/copec/sincronizar.js` y `copecfuel/sincronizar.js` permanecen idénticos al repositorio base. La fixture Daily demuestra que sus rutas no pasan por el controlador de preparación modificado. No se cambiaron cron, flags ni secretos de Job 2.

## Reproducir las pruebas

Requiere Node.js 24 o un Node compatible con ejecución TypeScript y `stripTypeScriptTypes`. Desde la carpeta del repositorio:

```powershell
pnpm install --frozen-lockfile --ignore-scripts
pnpm --dir tools/validation install --frozen-lockfile --ignore-scripts
node tests/coseducam-worker.test.mjs
node --experimental-vm-modules tests/coseducam-preparation.test.mjs
node tests/coseducam-preparacion-db.test.mjs
node tests/coseducam-pipeline-db.test.mjs
node tests/coseducam-daily-independence.test.mjs
pnpm --dir tools/validation exec tsc --project ../../tests/tsconfig.edge.json
pnpm build
```

Ejecutar las suites por separado como arriba. El entorno de esta tarea impide el aislamiento por procesos del runner de Node y los procesos auxiliares de Vite; no se modificó el código del portal para evitar esas restricciones.

## Límites pendientes de verificación

- No se validó despliegue real de Vercel ni arranque de la plataforma Deno/Supabase. Las pruebas usan las API web de Node y un adaptador Deno local, sin llamadas de red.
- El SQL se ejecutó contra fixtures de los contratos recuperados. El preflight debe confirmar el esquema y permisos reales antes de instalarlo.
- PGlite es una sesión: se verificaron locks `SHARE`, advisory por fecha, restricción única e idempotencia, pero no contención real entre sesiones. Los locks pueden hacer esperar escrituras concurrentes hasta el commit.
- `PREPARADA` certifica el snapshot persistido disponible. No certifica completitud del día ni inexistencia externa de una emisión no registrada. Los intentos operacionales previos o estados desconocidos bloquean la preparación.
- No se verificó el estado actual del cron en producción. Esta entrega no activa Job 1 ni modifica Job 2; el preflight permite comprobar sus estados sin alterarlos.
