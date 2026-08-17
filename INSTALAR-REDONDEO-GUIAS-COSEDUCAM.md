# Guías TAE Coseducam · litros enteros y creación sin bloqueos

## Archivos para GitHub

Sube los cinco archivos conservando exactamente sus carpetas:

- `api/conciliacion/muevo-empresa.js`
- `src/App.jsx`
- `src/coseducam-pwa/CoseducamPwa.jsx`
- `src/services/coseducamApi.js`
- `src/coseducam-pwa/styles.css`

No requiere SQL, migraciones ni variables nuevas en Vercel.

## Qué estaba fallando

Tres condiciones se pisaban entre sí y dejaban la fecha inutilizable.

**1. El código de estación se comparaba como texto.**
CopecFuel guarda la estación como `040098` y la pantalla solicitaba `40098`.
La vista mensual no filtraba por estación y la creación sí, de modo que el
portal mostraba los litros del día pero la creación respondía
*«No existen litros STORAGE diésel de Coseducam para la fecha seleccionada»*.
Ahora ambas rutinas comparan el número de estación, no el texto, y usan la
misma función para seleccionar las ventas.

**2. Una respuesta correcta del portal se tomaba como error.**
El código exigía que `data.error` fuera siempre una cadena. Cuando Copec
devolvía el número de guía sin ese campo, VALEPAC marcaba el día como
`revision_requerida` **aunque la guía sí había quedado emitida**. Ahora manda
el contenido: primero un error explícito del portal y después el número de
guía o el código de autorización.

**3. Cualquier fallo bloqueaba la fecha para siempre.**
Una fila en `procesando` o `revision_requerida` hacía que la creación
respondiera *«La fecha ya tiene una guía en estado … No se creó otra»*, y la
tabla del portal mostraba «Sin acción». Sólo se salía borrando la fila a mano
en Supabase.

## Cómo se comporta ahora

| Situación | Antes | Ahora |
| --- | --- | --- |
| Falla la red o el Portal TCT/TAE antes de autorizar | fecha bloqueada | no se guarda ninguna fila; el botón **Crear guía** sigue disponible |
| Falla después de enviar la autorización | fecha bloqueada | queda **Revisión requerida** con botón **Reintentar**, y avisa que revises el portal antes |
| La función se corta por tiempo | fila en `procesando` para siempre | a los 5 minutos el día vuelve a ser operable |
| El portal devuelve la guía sin campo `error` | se marcaba como fallida | se registra como creada |
| Ya existe una guía emitida | bloqueada | sigue bloqueada, a propósito, indicando el número de guía |

El reintento **reutiliza la misma fila** de `coseducam_guias`: nunca se generan
registros duplicados y se conserva el historial del intento fallido.

## Regla de redondeo

- Fracción menor que `0,5`: redondea hacia abajo.
- Fracción igual o superior a `0,5`: redondea hacia arriba.

Ejemplos:

- `501,49 L` crea una guía por `501 L`.
- `501,50 L` crea una guía por `502 L`.
- `2.917,51 L` crea una guía por `2.918 L`.

El entero lo calcula **sólo el servidor** y viaja en la respuesta como
`consumo.litrosGuia`. El portal web y la PWA lo muestran tal cual; ya no lo
recalculan por su cuenta. Además, la pantalla envía el entero que mostró y, si
el servidor obtiene otro (porque se importaron litros nuevos entretanto), pide
confirmación en lugar de emitir una guía por una cantidad distinta a la que
viste.

El entero resultante se usa de manera consistente en:

1. Los litros y el monto enviados al Portal TCT/TAE.
2. El registro de `coseducam_guias` en Supabase.
3. La validación y confirmación posterior en Copec en Ruta.

El consumo decimal original queda en la respuesta de auditoría y sigue visible
en pantalla junto al entero.

## Otros ajustes incluidos

- Las llamadas al Portal TCT/TAE se cortan a los 20 segundos con un mensaje
  claro, en vez de dejar la función colgada.
- `maxDuration` de la función sube a 60 segundos: la creación encadena el
  inicio de sesión Copec, cuatro consultas al portal y la autorización.
- Copec en Ruta acepta el entero de la guía y también el valor tal cual quedó
  guardado, para que las guías creadas antes de este cambio se sigan
  confirmando.
- La tabla del portal muestra una columna **Litros guía** separada del consumo
  decimal, y la PWA muestra ambos en el resumen del día.

## Prueba recomendada

Después del despliegue, con una fecha que no tenga guía creada:

1. Importa los litros.
2. Comprueba que el consumo decimal y los **litros enteros** coincidan con lo
   que ves en la tabla.
3. Pulsa `Crear TAE` y confirma.
4. Revisa que EnRuta muestre el mismo entero.
5. Pulsa `Confirmar EnRuta`.

Para verificar el desbloqueo, toma un día que hoy esté en «Revisión requerida»:
debe aparecer el botón **Reintentar** y, al pulsarlo, avisar si el intento
anterior alcanzó a enviar la autorización.
