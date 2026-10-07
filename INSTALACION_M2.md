# Instalación módulo M2

## 1. Base de datos
Ejecutar en Supabase SQL Editor el archivo:

`supabase/m2.sql`

Esto crea `m2_ventas` y la tabla independiente `m2_bluemax_costos` para registrar manualmente el costo BlueMax por fecha de vigencia.

## 2. Fuente de ventas
M2 se alimenta automáticamente durante la sincronización diaria existente de CopecFuel (`/api/copecfuel/sincronizar`). No hace una segunda consulta a CopecFuel.

Solo se guardan líneas que cumplan todas estas reglas:
- Emisor: Valencia y Pacheco Limitada (RUT 78.229.820-8).
- Producto: Diésel, G93, G95, G97 o BlueMax.
- Medio de pago: Crédito documentado, RutPay/Billetera BancoEstado, tarjeta de crédito, tarjeta de débito, efectivo o App Copec.
- Litros y precio venta mayores a cero.

Quedan fuera APP COPEC EMPRESA/MUEVO y cualquier otro medio no incluido.

## 3. Clasificación
- `operacionTipo=autoservicio` -> AUTOSERVICIO; lo demás -> ASISTIDA.
- `autorizadorFidelidadNombre=TAXI AMIGO` -> TAXI_AMIGO; lo demás -> NORMAL.

## 4. Fórmula
`M2 neto = ((precio venta - precio costo) / 1.19) * litros`

El precio costo se toma del último registro de `copec_precios_costo` cuya `fecha_vigencia` sea menor o igual a la fecha de venta.

## 5. BlueMax granel
El costo BlueMax se administra manualmente dentro del mismo módulo M2. Se ingresa `fecha de vigencia + costo bruto por litro`.

Cada venta BlueMax usa el último costo cuya `fecha_vigencia` sea menor o igual a la fecha de la venta. Si todavía no existe costo vigente, la venta aparece como **Sin costo** y no se suma al M2.

El historial queda separado de Recompra en `m2_bluemax_costos`, para no alterar los costos oficiales de gasolinas y diésel.

## 6. Carga inicial
Después de desplegar y ejecutar el SQL, resincronizar desde el primer día del mes deseado usando la sincronización CopecFuel existente. Esto poblará `m2_ventas` para esos días.
