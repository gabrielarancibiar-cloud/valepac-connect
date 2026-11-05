# VALEPAC Connect — Seguimiento COSEDUCAM con lectura parcial del día

## Propósito

El botón **Actualizar seguimiento** mantiene el histórico ya confirmado leyendo
`public.coseducam_consumos` (Supabase) y el reporte En Ruta en modo solo lectura.
**Antes de las 23:50 (America/Santiago)**, si el período seleccionado incluye
hoy, consulta **directamente la API oficial CopecFuel** para obtener las cargas
STORAGE diésel de COSEDUCAM de EDS 40098 hasta ese momento.

El resultado actual se presenta como **Pendiente de cierre** y **Consumo en vivo ·
Datos parciales**. En Ruta sigue siendo el origen de la información de guías,
pero el día parcial jamás se acredita como "Retiro TAE OK".

### Fuentes según fecha

- Días anteriores: `coseducam_consumos` + Excel En Ruta, sin escrituras.
- Hoy antes de 23:50: API oficial CopecFuel en tiempo de consulta + Excel En Ruta.
- Hoy desde 23:50: la tabla `coseducam_consumos` queda como fuente del cierre,
  que debe alimentar **el proyecto externo**. No se crea una captura ni se
  procesa Data Lake desde VALEPAC Connect.

### Qué no hace el botón

- No lee ni modifica el archivo `.json.gz` guardado en Storage.
- No ejecuta `sincronizarM2LakeDia`, `/api/archive` ni `/api/process`.
- No crea TAE ni llama a `modificarPedido` en En Ruta.
- No guarda consumos parciales, no altera snapshots ni jobs y no habilita cron.

### Instalación

Subir los archivos del ZIP de parche respetando sus rutas. No crear nuevas
funciones de Vercel, tablas, variables de entorno ni Edge Functions. Esta
lectura emplea la configuración CopecFuel que ya usa el proyecto.

### Prueba operativa

1. Antes de las 23:50 seleccionar la fecha de hoy y pulsar Actualizar seguimiento.
2. Debe verse la etiqueta «Consumo en vivo · Datos parciales», cargas, litros
   y precio máximo, con estado «Pendiente de cierre».
3. Si falla la API, se muestra una advertencia; no se presenta un supuesto cero
   como una lectura en vivo confirmada.
4. Consultar una fecha anterior: se mantiene la conciliación histórica sin cambios.
5. Después del cierre externo, consultar nuevamente el día anterior y verificar
   el retiro mediante el reporte oficial En Ruta.

**Nota:** el resultado depende de que la API oficial CopecFuel haya publicado
las transacciones recientes; puede existir latencia respecto a la carga real.

### Verificaciones técnicas

- Casos automatizados para filtreo de cliente/medio de pago/producto/EDS,
  precio máximo, duplicados, fecha, corte de 23:50, lectura sin persistencia,
  aislamiento histórico y fallo de API.
- No fue posible ejecutar la compilación Vite completa: no están instaladas
  las dependencias `node_modules` en este entorno.
