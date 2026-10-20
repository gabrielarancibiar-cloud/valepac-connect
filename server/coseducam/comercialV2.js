// Vista consistente con el corte y el criterio de precio STORAGE de las RPC V2.
// Las fechas anteriores al inicio automático son SOLO CONSULTA.
export const FECHA_INICIO_TAE_V2 = "2026-10-15";
export const HORA_CORTE_TAE = "23:50:00";
export const EDS_TAE = "40098";

const positivo = (valor) =>
  valor !== null && valor !== undefined && valor !== "" &&
  Number.isFinite(Number(valor)) && Number(valor) > 0;

export function clasificarConsumosV2(fecha, filas = []) {
  const historico = fecha < FECHA_INICIO_TAE_V2;
  const inicio = `${fecha}T00:00:00`;
  const corte = `${fecha}T${HORA_CORTE_TAE}`;
  const fin = `${fecha}T24:00:00`;
  const elegibles = [];
  const excluidos = [];
  const invalidos = [];

  for (const fila of filas) {
    if (String(fila.codigo_eds ?? EDS_TAE) !== EDS_TAE || fila.fecha !== fecha) continue;
    const hora = typeof fila.fecha_cierre_copec === "string"
      ? fila.fecha_cierre_copec.replace(" ", "T").slice(0, 19) : "";
    const precio = fila.precio_unitario;
    const productoValido = String(fila.producto || "").trim().toUpperCase() === "DIESEL";
    // CopecFuel aporta hora local codificada en Unix UTC: no restar el desfase chileno.
    const raw = Number(fila.fecha_cierre_copec_raw);
    const fechaRawValida = fila.fecha_cierre_copec_raw != null && Number.isSafeInteger(raw) && raw > 0 && raw < 4102444800 &&
      new Date(raw * 1000).toISOString().slice(0, 19) === hora;
    const datosValidos = positivo(fila.litros) && positivo(precio) && productoValido &&
      fila.transaccion_id != null && String(fila.transaccion_id).trim() &&
      fila.transaccion_codigo != null && String(fila.transaccion_codigo).trim() &&
      fechaRawValida;
    // Histórico: preservar los litros que ya se veían, pero no presentar
    // una guía histórica como elegible para el motor V2.
    if (historico) {
      elegibles.push(fila);
      if (!datosValidos || !hora || hora < inicio || hora >= fin) invalidos.push(fila);
      continue;
    }
    if (!hora || hora < inicio || hora >= fin) { invalidos.push(fila); continue; }
    if (hora >= corte) { excluidos.push(fila); continue; }
    elegibles.push(fila);
    if (!datosValidos) invalidos.push(fila);
  }
  const suma = (ventas) => Math.round(ventas.reduce((n, f) => n + (Number(f.litros) || 0), 0) * 1000) / 1000;
  const precios = elegibles.map((f) => Number(f.precio_unitario)).filter((n) => Number.isFinite(n) && n > 0);
  const ids = new Set(elegibles.map((f) => String(f.transaccion_id)));
  const codigos = new Set(elegibles.map((f) => String(f.transaccion_codigo)));
  const duplicados = ids.size !== elegibles.length || codigos.size !== elegibles.length;
  const completo = invalidos.length === 0 && !duplicados && elegibles.length > 0 && precios.length === elegibles.length;
  return {
    historico, elegibles, excluidos, invalidos,
    registros: elegibles.length, registrosExcluidos: excluidos.length,
    litros: suma(elegibles), litrosExcluidos: suma(excluidos),
    precioTae: completo ? Math.max(...precios) : null,
    precioMinimo: completo ? Math.min(...precios) : null,
    transacciones: ids.size, completo, duplicados,
    fechaCorte: `${fecha}T${HORA_CORTE_TAE}`,
  };
}

export function debeBloquearEmisionV2({ fecha, hoyChile, ahoraChile, flag = false }) {
  return !flag || !fecha || fecha !== hoyChile || fecha < FECHA_INICIO_TAE_V2 ||
    ahoraChile < `${fecha}T${HORA_CORTE_TAE}`;
}
