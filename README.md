# COSEDUCAM Autónomo

## Actualización v0.3.0 · Precio máximo de cargas STORAGE (24-10-2026)

**Regla definitiva:** el precio unitario TAE se calcula como el **mayor valor de `precio`** de **esas mismas ventas reales** que cumplen **EDS 40098 + cliente RUT 96.963.630-1 + diésel + medio STORAGE + cierre anterior a 23:50:00** en el día operacional. Se suman los litros de esas mismas ventas y se redondea el total al entero más cercano (0,5 sube). La multiplicación del monto TAE sigue siendo `Math.ceil(litrosGuia * precioMaximoStorage)`; `unidad = litrosGuia.toFixed(2)`. El precio máximo no se obtiene de ventas asistidas que no sean STORAGE ni del precio del portal TAE.

Ejemplo: STORAGE 300 L a $1.490; 250 L a $1.497; 400 L a $1.495 ⇒ **950 L, $1.497/L, $1.422.150**. Las transacciones desde las 23:50 quedan fuera de cualquier cálculo, almacenamiento y regularización automática. Si una venta incluida no acredita litros y precio válidos, el snapshot se bloquea para revisión; no se inventa ni se sustituye el precio.

**Cómo actualizar una instalación v0.2 (la actual):**

1. **Mantener** `OPERATIONS_ENABLED=false`, `TAE_ENABLED=false`, `ENRUTA_ENABLED=false`. No cambiar los tres bloqueos. El Cron existente puede continuar ejecutando `/api/tick` con respuesta `desactivado`.
2. **Supabase nuevo → SQL Editor:** ejecutar exclusivamente el archivo **`supabase/migrations/002_precio_maximo_storage.sql`**. No volver a ejecutar `001_base.sql`. Esta migración agrega `precio_unitario` por transacción y obliga a que el precio aplicado sea exactamente el máximo de las ventas STORAGE del snapshot. No emite ni confirma guías.
3. **GitHub del nuevo repositorio:** reemplazar los archivos del repositorio por los del ZIP v0.3, respetando las carpetas; `.env.example` es un ejemplo sin secretos. Vercel desplegará automáticamente el nuevo commit si sigue conectado a GitHub. No hace falta recrear Vercel, Supabase, Edge Function ni el Cron.
4. **Vercel:** comprobar el despliegue. El endpoint de diagnóstico privado `GET /api/copecfuel/diagnostico` devuelve ahora `precioMaximoStorage` (sustituye el campo anterior `precioDieselObservado`), `litros`, `litrosGuiaCalculados`, `transaccionesCoseducam`; no escribe en Supabase. Hay que usar el `STATUS_SECRET` ya configurado.
5. **Verificación local:** `npm test` debe ejecutar 22 pruebas. **Esto no valida los datos reales del proveedor ni la integridad del corte**: producción y emisión TAE continúan deshabilitadas hasta una verificación externa específica.

**SQL de comprobación sin exponer datos:**

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema='public' AND table_name='coseducam_consumos'
  AND column_name='precio_unitario';
```

La nueva columna debe figurar como `integer`. Si la migración da error, **no habilitar** ningún flag de operación.

---

# COSEDUCAM Autónomo · EDS 40098

Repositorio **independiente** de VALEPAC Connect. Contiene exclusivamente la base de automatización de guías diésel STORAGE para COSEDUCAM.

**Estado de entrega: base de instalación / integración pendiente. NO ES UNA AUTOMATIZACIÓN PRODUCTIVA VALIDADA.** Vercel, Supabase y GitHub nuevos, sin accesos compartidos con VALEPAC Connect. El proyecto no viene conectado a ninguna cuenta y no contiene credenciales reales.

## Antecedente v0.2.0 · Lectura CopecFuel (23-10-2026)

**Se reemplazó el adaptador ficticio `GET ?fecha=...`** por el contrato real documentado en código anterior de VALEPAC: `POST https://api2pr.copecfuel.com/INTEGR1/transacciones`, encabezado `token` y cuerpo `{clienteId, turnoId: "AAAAMMDD", tipoReporte: ["VENTA_COMBUSTIBLE"]}`. **Este POST solo consulta un reporte.** No autoriza TAE ni confirma En Ruta.

El conector se instala en este repositorio nuevo y no accede al GitHub, Vercel, Supabase ni API de VALEPAC Connect. Sin embargo, necesita credenciales válidas del proveedor CopecFuel (`COPEC_TOKEN`, `COPEC_CLIENTE_ID`), gestionadas exclusivamente en el Vercel nuevo.

### Diagnóstico privado de lectura

Las instrucciones de actualización vigentes están en **v0.3** al inicio de este README. En Vercel se requieren `COPEC_API_URL`, `COPEC_TOKEN` y `COPEC_CLIENTE_ID` (12 dígitos), almacenados solo como variables de entorno del proyecto nuevo.

Después de desplegar, se puede consultar exclusivamente la ruta **solo lectura** `GET /api/copecfuel/diagnostico`, protegida por `x-status-secret`. En PowerShell:

```powershell
$entrada = Read-Host "STATUS_SECRET de Vercel" -AsSecureString
$clave = [System.Net.NetworkCredential]::new("", $entrada).Password
try {
  Invoke-RestMethod -Method GET `
    -Uri "https://coseducam-autonomo.vercel.app/api/copecfuel/diagnostico" `
    -Headers @{ "x-status-secret" = $clave }
} finally { Remove-Variable clave,entrada -ErrorAction SilentlyContinue }
```

La respuesta no contiene transacciones individuales ni identificadores de clientes: informa `transaccionesCoseducam`, `litros`, `litrosGuiaCalculados` y `precioMaximoStorage`. Si CopecFuel aún no tiene ventas completas, puede responder 503 o mostrar totales preliminares. **El diagnóstico no acredita por sí solo la integridad del corte.**

El timestamp `transaccionFechaCierre` observado en el portal está codificado como segundos con **hora civil de CopecFuel**: se usa la hora en UTC de ese valor como hora civil original, sin convertirla nuevamente a Chile (ver prueba `2026-10-14`, timestamp `1791946474` → `02:54:34` del 14-10). El calendario del Cron sí usa `America/Santiago`. Confirmar esta semántica con el proveedor y datos del día antes de producción.

### Advertencia sobre disponibilidad del cierre

Una lectura exitosa a las 23:50 no demuestra que CopecFuel ya haya publicado **todos** los movimientos anteriores al corte; hemos observado retrasos de actualización. Mientras no se acredite la integridad del corte, **no habilitar emisión**. Nunca completar consumos con datos del siguiente día ni incorporar ventas posteriores a las 23:50:00.

**Pruebas v0.2:** 15 pruebas locales en Node.js y validación sintáctica; **sin consultas reales al proveedor** (no se disponía de token) y **sin emisiones TAE ni confirmaciones En Ruta**.

## Arquitectura

```text
GitHub (este repositorio)
       |
       +--> Vercel (API privada)
       |      /api/tick   POST solo Edge, token x-worker-secret
       |      /api/copecfuel/diagnostico  GET privado, solo reporte CopecFuel
       |      /api/estado GET privado, token x-status-secret
       |      lib/logic.js    regla de corte + cálculo
       |      lib/copec.js    adaptadores CopecFuel + TCT/TAE + En Ruta
       |      lib/worker.js   maquina de estados, sin reintentos mutadores
       |
       +--> Supabase nuevo
              public.coseducam_consumos
              public.coseducam_jobs
              public.coseducam_guias
              public.coseducam_eventos
              pg_cron cada minuto (control de hora de Chile en SQL)
                    -> pg_net -> Edge coseducam-tick
                                      -> Vercel /api/tick
```

Los cambios posteriores a las **23:50:00 de Chile** quedan fuera de esta automatización: no se persisten ni regularizan ni se detectan como un proceso excepcional. Administración los gestiona externamente y de forma 100 % manual. El corte incluye únicamente transacciones reales anteriores a las 23:50:00. Nunca emitir pruebas TAE con litros falsos.

## Qué viene incluido

- SQL con tablas nuevas, RLS habilitado, restricciones únicas `(fecha, codigo_eds)` y funciones RPC privadas.
- Cron independiente de la diferencia UTC/verano-invierno: se despierta cada minuto, pero crea el trabajo del día solo después de las 23:50 de **America/Santiago**.
- Validación de RUT COSEDUCAM, combustible diésel, medio STORAGE, precios unitarios de las mismas cargas STORAGE y hora de cada transacción.
- Protección anti duplicación y redondeo: `0,5` hacia arriba; importe TAE `Math.ceil(litros * precio)` y unidad `litros.toFixed(2)`.
- Registro de intento **antes** de emitir la guía o confirmar En Ruta. Respuestas inciertas quedan en revisión humana, sin reenvío automático.
- 10 búsquedas de disponibilidad En Ruta máximo; se reintenta **solo la lectura** cuando la guía aún no aparece. Nunca se reintenta automáticamente la confirmación mutadora.
- API de estado privada, sin panel público con información sensible.
- 22 pruebas locales (`npm test`), incluyendo la consulta CopecFuel simulada.

## No implementado todavía: validaciones obligatorias para operar

1. **CopecFuel**: adaptador oficial POST de solo reporte incorporado en v0.2.0. Falta colocar las credenciales en Vercel y validar la respuesta real, la hora de cierre y la integridad del conjunto de ventas disponible al corte. El diagnóstico privado está disponible sin escrituras.
2. **Login renovable de Copec**: el ZIP acepta temporalmente un token TCT/TAE en `TCT_TAE_TOKEN`, pero **no incorpora la renovación automática de sesión** porque el código de login original no estaba disponible para verificar. Debe trasladarse el login real, con sus cookies/tokens, antes de producción. No copiar credenciales de las cuentas anteriores al GitHub nuevo.
3. **En Ruta**: verificar desde HAR el login, cookies/sesión y la respuesta actual de `gMonitorPedido`, `infoModificar` y `modificarPedido`. El adaptador sigue el contrato usado anteriormente, pero sin acceso de producción no se puede asegurar compatibilidad.
4. **Precios CopecFuel**: validar en transacciones reales que el campo `precio` pertenece a cada guía STORAGE COSEDUCAM y que el máximo calculado coincide con el mayor precio de esas mismas guías; la moda de ventas asistidas ya no interviene.
5. Validar la migración v0.3 en el Supabase nuevo y el despliegue actualizado de Vercel. Las pruebas locales no reemplazan la verificación con datos reales del proveedor.

**No activar** `OPERATIONS_ENABLED`, `TAE_ENABLED` y `ENRUTA_ENABLED` hasta resolver los cinco puntos. Cuando cualquiera de ellos está en `false`, `/api/tick` devuelve `desactivado` y no programa trabajo ni emite ni confirma.

## Crear cuentas nuevas y conectar

### 1. GitHub

Crear repositorio **privado** llamado `coseducam-autonomo` en la nueva cuenta. Subir solamente los archivos de este directorio (no subir el ZIP, archivos `.env` ni tokens). O desde una terminal:

```bash
git init
git add .
git commit -m "Base independiente COSEDUCAM"
git branch -M main
git remote add origin https://github.com/TU-CUENTA/coseducam-autonomo.git
git push -u origin main
```

### 2. Supabase

Crear proyecto nuevo en la nueva cuenta. En **SQL Editor**, ejecutar una sola vez `supabase/migrations/001_base.sql`. Verificar que las tablas comienzan vacías y están protegidas por RLS.

Copiar del nuevo proyecto:
- URL: `https://<nuevo-ref>.supabase.co`.
- **Secret API key** `sb_secret_...` del proyecto nuevo, para Vercel; no utilizarla en navegador.

### 3. Vercel

Importar el repositorio privado a **proyecto nuevo**, framework `Other`, Node >= 20. Configurar variables con `.env.example` como guía. **Nunca** usar claves del proyecto VALEPAC Connect antiguo. Primero dejar los tres flags `false`.

Una vez desplegado, la API privada queda en:

```
GET  https://TU-VERCEL.vercel.app/api/estado
POST https://TU-VERCEL.vercel.app/api/tick
```

Ejemplo de inspección con autenticación (sustituir token localmente; no compartir capturas con tokens):

```bash
curl -H "x-status-secret: MI_STATUS_SECRET" \
  https://TU-VERCEL.vercel.app/api/estado
```

### 4. Edge Function de Supabase

En el **nuevo proyecto**, desplegar la función `supabase/functions/coseducam-tick/index.ts` usando CLI Supabase o su interfaz de funciones. La configuración `supabase/config.toml` usa `verify_jwt = false`: esto **no** deja la función pública, porque el código exige autenticación `apikey` con `@supabase/server` (`auth:'secret'`). No poner `sb_secret_...` en `Authorization: Bearer`: utilizar el encabezado `apikey`. [Documentación de Supabase](https://supabase.com/docs/guides/functions/auth).

Definir secretos de Edge Function:

```text
VERCEL_WORKER_URL=https://TU-VERCEL.vercel.app/api/tick
VERCEL_WORKER_SECRET=MISMO_VALOR_DE_WORKER_SECRET_EN_VERCEL
```

Luego, en SQL Editor de Supabase, guardar **en Vault** la URL del proyecto y la nueva **secret API key** con estos nombres:

```sql
select vault.create_secret('https://TU-NUEVO-PROYECTO.supabase.co', 'coseducam_project_url');
select vault.create_secret('TU-SB_SECRET-NUEVA', 'coseducam_secret_key');
```

Cuando **la función ya esté desplegada y autenticando correctamente**, ejecutar `supabase/cron/activar.sql`. Programa `* * * * *` y **no depende de una expresión UTC fija para las 23:50**; el cálculo horario se efectúa dentro del RPC usando `America/Santiago`. [Documentación de programación Supabase](https://supabase.com/docs/guides/functions/schedule-functions).

Para suspender la programación inmediatamente, ejecutar `supabase/cron/desactivar.sql`. Pausar el cron **no cancela ninguna guía que un envío anterior ya haya emitido**.

### 5. Comprobar instalación sin emitir guías

Con flags apagados, hacer `GET /api/estado` usando su secreto de lectura. Probar autenticación del conector Edge→Vercel y observar `desactivado`. En Supabase, revisar:

```sql
select jobname,schedule,active from cron.job where jobname='coseducam-cada-minuto';
select fecha,estado,numero_guia,ultimo_error from public.coseducam_jobs order by fecha desc;
```

Para pruebas de lógica, ejecutar `npm test`. **No usar nunca TAE real ni confirmar En Ruta con datos ficticios.** La primera operación productiva requiere confirmar los contratos reales y los cinco puntos pendientes.

## Archivos

| Archivo | Responsabilidad |
| --- | --- |
| `lib/logic.js` | Reglas de negocio, filtrado y cálculo |
| `lib/copec.js` | Integraciones TAE y En Ruta, aún desactivadas |
| `lib/copecfuel.js` | Consulta oficial de reporte CopecFuel, sin escrituras |
| `api/copecfuel/diagnostico.js` | Diagnóstico privado de consumos, solo lectura |
| `lib/worker.js` | Máquina de estados / auditoría |
| `api/tick.js`, `api/estado.js` | API privada Vercel |
| `supabase/functions/coseducam-tick/index.ts` | Disparador Edge autenticado |
| `supabase/migrations/001_base.sql` | Esquema, RLS, RPC |
| `supabase/cron/activar.sql` | pg_cron con Vault + pg_net |
| `supabase/cron/desactivar.sql` | Pausar cron |
| `test/logic.test.js`, `test/copecfuel.test.js` | 22 pruebas sin efectos externos |

## Seguridad operacional

- Un mismo día y EDS nunca tiene dos guías locales: `UNIQUE(fecha,codigo_eds)`.
- Si hay caída o timeout después de solicitar TAE, queda `emitiendo`/`revision_requerida`, **jamás segundo POST automático**.
- Si hay caída o timeout después de confirmar En Ruta, queda `confirmando`/`revision_requerida`, **jamás segundo POST automático**.
- No modificar `estado` a mano para forzar reemisiones. Revisar el portal externo y documentar la resolución con Administración.
- Las credenciales son únicamente de los proyectos nuevos y permanecen en Vercel Environment Variables, Supabase Edge Secrets y Vault. Nada de claves `service_role`/`sb_secret` ni cookies en un navegador público.



## Diagnóstico de EDS (v0.3.1; sin escrituras)

La ruta `GET /api/copecfuel/diagnostico` (autenticada mediante `x-status-secret`)
responde `HTTP 422` con `diagnosticoEds` si alguna fila anterior al corte
no acredita la EDS 40098. El objeto incluye **solo conteos** de filas con EDS
correcta, ausente o diferente, y nombres de posibles campos alternativos.
No incluye transacciones, clientes, patentes, secretos ni precios ajenos.
No autoriza inferir EDS a partir del clienteId: la verificación sigue
bloqueando el snapshot ante origen no acreditado.

La comprobación de EDS se realiza **después de excluir el tramo fuera del corte**
para no inspeccionar ni influir en las cargas posteriores a las 23:50.

No requiere SQL nuevo ni modificar las variables de Vercel. Subir el código a
GitHub y esperar un Deploy `Ready` de Vercel. Volver a usar el mismo PowerShell
de diagnóstico; comunicar solo `diagnosticoEds`, sin valores de secretos.


## Diagnóstico de origen CopecFuel v0.3.2 (solo lectura)

La API devuelve filas sin `codigoEds` y el filtro estricto las bloquea. Esta versión
no etiqueta automáticamente las 1.545 filas como estación 40098. En un HTTP 422,
`diagnosticoEds` informa también `codigosConPrefijo40098`, `codigosConOtroPrefijo`
y `codigosAusentes` (agregados, nunca identificadores). `diagnosticoOrigen`
indica si el sobre del reporte **declara** un código de estación y si el `clienteId`
del sobre coincide con el solicitado, sin mostrar identificadores de clientes ni
valores secretos.

Si el proveedor no declara el código de EDS a nivel de sobre, la corrección de
producción exige acreditar con Copec que `COPEC_CLIENTE_ID` se corresponde de
forma exclusiva con EDS 40098, idealmente con documentación o un reporte de
referencia ya verificado. NO considerar el prefijo del identificador de venta como
única prueba. Por ahora el bloqueo continúa, no se escribe en Supabase y no se
habilita TAE/En Ruta.

Subir código a GitHub y dejar que Vercel despliegue. No requiere SQL, secretos
nuevos ni modificaciones a los tres flags `false`.
