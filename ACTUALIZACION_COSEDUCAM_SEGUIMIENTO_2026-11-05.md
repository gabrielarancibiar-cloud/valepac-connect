# VALEPAC Connect | Seguimiento TAE COSEDUCAM (05-11-2026)

Base: archivo **valepac-connect-main (1)(1).zip** proporcionado por el usuario.

## Objetivo
El portal VALEPAC Connect y la PWA COSEDUCAM solo fiscalizan el retiro TAE tras el cierre de cada jornada. No crean ni confirman guías. La automatización externa del usuario no se modifica.

## Cambios
- El estado `CERRADO` o `ENTREGADO` del Excel de En Ruta se considera retiro finalizado, como confirmó el operador.
- Cruce por EDS 40098, identidad COSEDUCAM, producto diésel y **FECHA CREACION**; **FECHA ESTADO** se conserva como el instante del último cambio de estado (incluso si fue el día siguiente).
- La guía se identifica por `GUIA TAE`/`GUIA` o, cuando no aparecen, por `DTE`, siempre con las demás comprobaciones.
- Litros esperados: total STORAGE del Data Lake redondeado al entero (0,5 hacia arriba).
- Una o varias guías finales pueden conciliar si sus litros entregados, sin duplicar referencias, suman los litros enteros esperados.
- Un pedido `PENDIENTE ENVÍO` aún con 0 litros entregados **no** se marca como diferencia de litros.
- La PWA selecciona por defecto el día anterior; presenta secciones CopecFuel / En Ruta / Comparación.
- El portal muestra los días recientes primero, las fechas de estado y un resumen de la diferencia en litros reales.
- Estados con un color discreto: verde OK, ámbar pendiente, terracota revisión, azul-gris día en curso.
- No se añaden endpoints ni Serverless Functions en Vercel.

## Archivos de producción modificados
1. `server/coseducam/seguimientoSoloLectura.js`
2. `src/App.jsx`
3. `src/coseducam-pwa/CoseducamPwa.jsx`
4. `src/coseducam-pwa/styles.css`
5. `src/styles.css`

## Archivo nuevo de producción
6. `src/utils/coseducamSeguimiento.js`

## Pruebas
- `tests/coseducam-seguimiento-solo-lectura.test.mjs`: actualizado para el criterio operacional y casos reales de 04-11-2026.
- Ejecutadas: 57 pruebas de Node compatibles con el entorno, todas aprobadas.
- Sintaxis JSX (TypeScript parser) y CSS (PostCSS): aprobadas.
- Compilación Vite completa: no ejecutada aquí por falta de dependencias instaladas.
- Hay cuatro suites previas de DB/worker que requieren módulos/flags de Node ausentes en este entorno, no alteradas por el parche.

## Instalar
1. Hacer copia de seguridad de la rama `main` vigente.
2. Reemplazar los archivos con las rutas indicadas (usar el ZIP de solo cambios), o subir el ZIP del repositorio completo si coincide con la versión actual.
3. Comprobar el despliegue de Vercel Production en `Ready`.
4. Abrir la PWA y consultar el día 04-11-2026. Confirmar que la guía 47268116 pertenece a COSEDUCAM (RUT / CLIENTE TAE) en el reporte real, que esté CERRADA y que sus 353 L se concilien con 353,2 L del Data Lake.
5. Confirmar otro día con estado pendiente y otro con guía finalizada al día siguiente.

## Precauciones
Esta actualización NO ejecuta cambios en Supabase SQL, el worker externo, el cron ni los secretos. La comprobación real depende de los datos que devuelva En Ruta en producción. Una guía de otro cliente, con fecha incorrecta, duplicada o con litros que no concilian NO se muestra como OK.
