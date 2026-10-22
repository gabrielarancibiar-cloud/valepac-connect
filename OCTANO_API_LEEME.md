# VALEPAC Connect · Octano Read API V1

**Integración sobre el main actualizado recibido el 22/10/2026.** Se conservan las actualizaciones COSEDUCAM V2 del nuevo main, incluidos `server/coseducam/estadoHabilitacionV2.js` y `coseducam_v2_preflight_tae`. Ninguna ruta o cálculo COSEDUCAM se ha reemplazado.


## Alcance

Esta versión agrega **exclusivamente cinco endpoints GET** para una IA externa con un token privado. No permite escrituras, sincronizaciones, cierres, cambios de costos ni emisiones de TAE. No modifica tablas ni requiere migraciones SQL.

La API reutiliza las funciones de lectura del backend existente y entrega **datos**, no un diagnóstico nuevo ni un cálculo financiero alternativo. Octano interpretará los resultados. En particular, los márgenes de Recompra ($1.000 / $20.000) y el requisito de Muevo (diferencia $0) corresponden a reglas que aplica la IA externa y NO cambian los cálculos del portal.

| Método | Ruta | Datos utilizados |
|--|--|--|
| GET | `/api/octano/v1/conciliacion` | Conciliación mensual CopecFuel / Portal Copec |
| GET | `/api/octano/v1/recompra` | Recompra Lake: bases, ajustes, precios y abonos |
| GET | `/api/octano/v1/muevo` | Muevo Empresa: ventas vs cargos |
| GET | `/api/octano/v1/m2` | M2 Lake: resumen del margen |
| GET | `/api/octano/v1/resumen` | Las cuatro consultas anteriores, agrupadas |

## Instalación / despliegue

1. Subir los archivos del ZIP a la rama que utiliza el proyecto Vercel **VALEPAC Connect**. Verificar el diff antes de desplegar: la lógica de negocio preexistente solo agregó exports de funciones de lectura; conciliación mensual se extrajo a una función común manteniendo el handler anterior.
2. Vercel → proyecto VALEPAC Connect → **Settings → Environment Variables** → agregar:
   - **Nombre:** `OCTANO_READ_TOKEN`
   - **Valor:** el token seguro entregado **por separado del ZIP** (o crear uno nuevo con `openssl rand -hex 32`).
   - **Entorno:** Production (también Preview si se desea probar allí). Tratarlo como secreto; nunca ponerlo en variables `VITE_*` ni publicar en GitHub.
3. Mantener sin cambios `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` existentes en Vercel. No compartir esa clave con Octano.
4. Ejecutar un **nuevo deployment** en Vercel (los cambios de variables de entorno no actualizan automáticamente los deployments anteriores).
5. Validar con `GET /api/octano/v1/m2?periodo=2026-10` autenticado y cotejar las cifras con la pantalla M2. Repetir con los otros módulos antes de conectar Octano.

**IMPORTANTE:** El paquete no despliega ni activa los endpoints por sí solo. No enviar el token a Octano antes de cargar el mismo valor en Vercel y desplegar.

## Autenticación

Se exige exclusivamente cabecera HTTP:

```http
Authorization: Bearer <OCTANO_READ_TOKEN>
Accept: application/json
```

No se admite el token en URL ni en el body. Sin secreto configurado devuelve HTTP 503; con token ausente o incorrecto devuelve HTTP 401. Solo `GET` está permitido; para cualquier otro método devuelve HTTP 405.

La revocación se realiza cambiando `OCTANO_READ_TOKEN` en Vercel y realizando un nuevo despliegue. No copiar el token a la app React ni al repositorio. Para una mayor defensa pueden configurarse límites de tasa y controles de red en Vercel, pero esta entrega no requiere ni activa configuraciones externas.

## Consultas

```bash
# Sin filtros: mes vigente de Chile (America/Santiago)
curl -H "Authorization: Bearer $OCTANO_READ_TOKEN" \
  https://valepac-connect.vercel.app/api/octano/v1/recompra

# Mes determinado
curl -H "Authorization: Bearer $OCTANO_READ_TOKEN" \
  'https://valepac-connect.vercel.app/api/octano/v1/muevo?periodo=2026-10'

# Día determinado
curl -H "Authorization: Bearer $OCTANO_READ_TOKEN" \
  'https://valepac-connect.vercel.app/api/octano/v1/m2?fecha=2026-10-15'
```

Las URL de ejemplo presuponen que el dominio del proyecto en Vercel es `valepac-connect.vercel.app`; verificarlo en el panel Domains antes de copiarlas a la IA.

### Formato de salida

```json
{
  "ok": true,
  "modulo": "muevo",
  "periodo": "2026-10",
  "datos": {
    "rango": {"desde":"2026-10-01","hasta":"2026-10-22"},
    "resumen": {"...":"valores reales calculados por VALEPAC Connect"},
    "dias": []
  },
  "fechaConsulta": "2026-10-22T13:00:00.000Z"
}
```

Este JSON es **solo estructural**; no representa movimientos ni importes reales. Para `fecha=AAAA-MM-DD` la respuesta contiene `datos.dia` y, **separadamente**, `datos.resumenMes`; el segundo sigue siendo el consolidado **mensual**. Para M2 se incluyen `detalleDia`, `productosDia` y `estadoDia`. En `/resumen`, `datos` contiene `{conciliacion, recompra, muevo, m2}`.

La API no fuerza que meses incompletos estén conciliados. Octano debe identificar fechas `sin_datos`, `sin_abonos`, `sin_ventas`, `sin_precio`, `sin_cargos` y registros del Lake pendientes; y no debe considerar equilibrado un mes solo porque diferencias opuestas se compensen.

## Archivos añadidos

- `api/octano/v1/{conciliacion,recompra,muevo,m2,resumen}.js`
- `api/octano/_lib/{auth,query,read,handler}.js`
- `tests/octano-read-api.test.mjs`
- `OCTANO_API_LEEME.md`

## Archivos existentes modificados (sin nueva lógica de negocios)

- `api/conciliacion/mensual.js`: la función de consulta/calculo pasó a `obtenerConciliacionMensual(periodo)` para que la ruta original y Octano utilicen **el mismo cálculo**.
- `api/conciliacion/muevo-empresa.js`: exporta `obtenerMes()` y `obtenerMesRecompraLake()` ya existentes, sin modificar su código interno.
- `api/m2.js`: exporta `obtenerM2Produccion()` ya existente, sin modificar su código interno.

## Pruebas ejecutadas localmente

`node --test tests/octano-read-api.test.mjs`

Cubren autorizaciones, métodos, parámetros y ensamblado de respuestas mediante datos simulados. Para comprobar cifras reales y tiempo de respuesta aún es necesario desplegar y contrastar contra Supabase y las pantallas de VALEPAC Connect.

### Validación de fusión de este main

- 8/8 pruebas de Octano correctas.
- 7/7 pruebas de prevalidación COSEDUCAM V2 correctas.
- El conjunto total tiene 5 fallos adicionales en pruebas COSEDUCAM antiguas que también ocurren en el main nuevo **sin fusionar** por dependencias/herramientas de pruebas no disponibles (`.ts`, `@electric-sql/pglite`, `SourceTextModule`). No representan fallos nuevos de Octano.
- No se ha hecho despliegue ni comparación de datos de producción.
