# EE.RR. Productos no combustibles

## 1. Crear las tablas y cargar los costos iniciales

En Supabase abre **SQL Editor**, crea una consulta nueva y ejecuta completo:

`supabase/eerr_productos.sql`

El script crea cuatro tablas aisladas:

- `productos_catalogo`
- `productos_costos`
- `productos_ventas`
- `productos_ajustes_mensuales`

También carga los 10 costos netos entregados, vigentes desde el 01-08-2026.
No modifica las tablas ni reglas de las conciliaciones actuales.

Si las tres tablas de EE.RR. ya existen, no vuelvas a ejecutar la carga inicial.
Ejecuta solamente `supabase/eerr_productos_ajustes_v2.sql` para agregar royalty
y notas de credito mensuales sin tocar los datos existentes.

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
4. Pulsa **Generar EE.RR.**.

La nueva vista presenta:

- venta neta, costo neto, comisiones y margen operacional;
- venta, costo y margen por categoría;
- composición del margen;
- resumen mensual por categoría;
- alerta de productos vendidos sin costo vigente;
- detalle por producto dentro de un desplegable.

El único botón **Administrar costos** abre una ventana con todos los productos activos,
su código, precio de venta observado, comisión unitaria observada, costo vigente
y fecha de vigencia. Desde esa ventana se puede actualizar la categoria,
registrar un nuevo costo con inicio y vencimiento, o importar una planilla
`.xlsx`, `.xls` o `.csv`.

La planilla admite estos encabezados: `Codigo`, `Producto`, `Categoria`,
`Costo neto`, `Vigente desde`, `Vencimiento` y `Proveedor`. El codigo identifica
al producto; si no se informa, el importador intenta encontrar una coincidencia
exacta por nombre.

Cada actualización inserta una nueva vigencia en `productos_costos`. Nunca
sobrescribe ni elimina los costos históricos. Si ya existe un costo diferente
para la misma fecha, el sistema solicita usar otra fecha para proteger el
historial.

El precio de venta y la comisión se obtienen de la última fecha con ventas del
producto. Para evitar valores excepcionales, se presenta la moda: el valor
unitario que más se repite en ese día. La comisión unitaria se calcula como
`totalComision / cantidad`.

## Regla financiera aplicada

- Venta neta: campo `baseTotal` de `VENTA_PRODUCTO`.
- Costo de venta: cantidad vendida por costo neto unitario vigente en la fecha.
- Comisiones: suma de `totalComision` de cada linea de `VENTA_PRODUCTO`.
- Margen operacional: venta neta menos costo de venta menos comisiones.
- Margen porcentual: margen operacional dividido por venta neta.

Royalty y notas de credito se registran solo en el total general del periodo;
no se reparten entre productos ni categorias. La formula es:

`Resultado final = margen operacional - royalty + notas de credito`.

Si se vende un producto sin costo vigente, el portal lo identifica y deja el
margen total como pendiente. No usa costo cero ni presenta un margen incompleto
como definitivo.

Cada cambio de costo debe agregarse a `productos_costos` con una nueva
`vigente_desde`; no se debe sobrescribir el costo anterior.
