# Redondeo entero de guías Coseducam

## Archivos para GitHub

Sube los tres archivos conservando exactamente sus carpetas:

- `api/conciliacion/muevo-empresa.js`
- `src/App.jsx`
- `src/coseducam-pwa/CoseducamPwa.jsx`

No requiere SQL ni variables nuevas en Vercel.

## Regla aplicada

- Fracción menor que `0,5`: redondea hacia abajo.
- Fracción igual o superior a `0,5`: redondea hacia arriba.

Ejemplos:

- `501,49 L` crea una guía por `501 L`.
- `501,50 L` crea una guía por `502 L`.
- `2.917,51 L` crea una guía por `2.918 L`.

El entero resultante se usa de manera consistente en:

1. Los litros enviados al Portal TCT/TAE.
2. El monto de la guía.
3. El registro de `coseducam_guias` en Supabase.
4. La validación y confirmación posterior en Copec en Ruta.

El consumo decimal original queda guardado dentro de la respuesta de auditoría
de la autorización y continúa visible en las pantallas de consumo.

## Prueba recomendada

Después del despliegue, utiliza una fecha que no tenga guía creada:

1. Importa los litros.
2. Pulsa `Crear TAE`.
3. Confirma que la ventana muestre el consumo decimal y los litros enteros de
   la guía.
4. Crea la guía.
5. Revisa que EnRuta muestre el mismo entero.
6. Pulsa `Confirmar EnRuta`.

