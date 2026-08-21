# EE.RR. Productos no combustibles

## 1. Crear las tablas y cargar los costos iniciales

En Supabase abre **SQL Editor**, crea una consulta nueva y ejecuta completo:

`supabase/eerr_productos.sql`

El script crea tres tablas aisladas:

- `productos_catalogo`
- `productos_costos`
- `productos_ventas`

También carga los 10 costos netos entregados, vigentes desde el 01-08-2026.
No modifica las tablas ni reglas de las conciliaciones actuales.

## 2. Subir el código

Sube el contenido del proyecto a GitHub conservando las rutas. Vercel hará el
despliegue automático.

No se agregan variables nuevas en Vercel. Se reutilizan:

- `COPEC_FUEL_VENTAS_TOKEN`
- `COPEC_FUEL_CLIENTE_ID`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `VALEPAC_ADMIN_EMAILS`

La implementación reutiliza `/api/copecfuel/oficial`, por lo que el proyecto
permanece dentro del máximo de 12 funciones serverless del plan Hobby.

## 3. Probar

1. Ingresa a VALEPAC Connect como administrador.
2. Abre **EE.RR. Productos**.
3. Selecciona agosto de 2026.
4. En **Procesar desde**, selecciona `01-08-2026`.
5. Pulsa **Sincronizar desde fecha**.

Como control conocido, para la muestra del 10-08-2026 el cálculo esperado es:

- 32 líneas.
- 10 productos.
- Venta neta: $212.453.
- Costo de venta: $158.471,47.
- Margen bruto: $53.981,53.
- Margen: 25,41%.

## Regla financiera aplicada

- Venta neta: campo `baseTotal` de `VENTA_PRODUCTO`.
- Costo de venta: cantidad vendida por costo neto unitario vigente en la fecha.
- Margen bruto: venta neta menos costo de venta.
- Margen porcentual: margen bruto dividido por venta neta.

Si se vende un producto sin costo vigente, el portal lo identifica y deja el
margen total como pendiente. No usa costo cero ni presenta un margen incompleto
como definitivo.

Cada cambio de costo debe agregarse a `productos_costos` con una nueva
`vigente_desde`; no se debe sobrescribir el costo anterior.
