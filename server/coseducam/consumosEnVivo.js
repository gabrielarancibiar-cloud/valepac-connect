// Vista de lectura inmediata. Replica los filtros de STORAGE COSEDUCAM usados
// en Data Lake, sin persistir operaciones ni construir una guia definitiva.
const EDS = '40098';
const RUT_COSEDUCAM = '969636301';
const normalizarTexto = (valor) => String(valor ?? '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^0-9A-Z]+/gi, ' ')
  .trim().replace(/\s+/g, ' ').toUpperCase();
const normalizarRut = (valor) => String(valor ?? '').replace(/[^0-9K]/gi, '').toUpperCase();

function esCoseducamStorage(fila) {
  if (normalizarTexto(fila.formaPagoNombre ?? fila.formaPago) !== 'STORAGE') return false;
  const producto = normalizarTexto(fila.productoDescripcion ?? fila.producto);
  if (!producto.includes('DIESEL') || producto.includes('BLUEMAX') || producto.includes('BLUE MAX')) return false;
  const codigos = [fila.clienteRutRut, fila.rutEmpresaReceptor, fila.rutCliente, fila.rut_cliente];
  const razones = [fila.clienteRutRazonSocial, fila.razonSocialReceptor, fila.razonSocialCliente];
  return codigos.some((r) => normalizarRut(r) === RUT_COSEDUCAM) ||
    razones.some((r) => normalizarTexto(r).includes('COSEDUCAM'));
}

function precioLiteral(valor) {
  if (!['number', 'string'].includes(typeof valor)) return null;
  const texto = String(valor).trim();
  if (!/^[0-9]+(?:\.[0-9]{1,3})?$/.test(texto)) return null;
  const n = Number(texto);
  return Number.isFinite(n) && n > 0 && n < 1_000_000_000 ? n : null;
}

function fechaCierreCivil(fila) {
  const rawTexto = String(fila.transaccionFechaCierre ?? '').trim();
  if (!/^[0-9]{10}$/.test(rawTexto)) return { raw: null, civil: null };
  const raw = Number(rawTexto);
  if (!Number.isSafeInteger(raw)) return { raw: null, civil: null };
  const fecha = new Date(raw * 1000);
  if (!Number.isFinite(fecha.getTime())) return { raw: null, civil: null };
  // CopecFuel codifica la hora CIVIL como componentes UTC; no trasladar zona.
  return { raw, civil: fecha.toISOString().slice(0, 19).replace('T', ' ') };
}

export function transformarConsumosEnVivo(fecha, reporte) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !Array.isArray(reporte?.filasCombustible)) {
    throw new Error('CopecFuel no entregó el reporte de combustible solicitado.');
  }
  if (reporte.codigoEds && String(reporte.codigoEds) !== EDS) {
    throw new Error('CopecFuel devolvió una EDS distinta de 40098.');
  }
  const filas = new Map();
  for (const venta of reporte.filasCombustible) {
    const estacion = String(venta.codigoEds || reporte.codigoEds || EDS);
    if (estacion !== EDS || !esCoseducamStorage(venta)) continue;
    if (String(venta.turnoId ?? '') !== fecha.replaceAll('-', '')) {
      throw new Error('Turno CopecFuel distinto del día consultado; vista parcial no acreditada.');
    }
    // Data Lake exige un identificador y monto de venta positivo antes de
    // incluir una transacción (excluye movimientos de control de total 0).
    const id = String(venta.transaccionId || '').trim();
    const monto = Number(venta.total);
    if (!id || !Number.isFinite(monto) || monto <= 0) continue;
    const codigo = String(venta.transaccionCodigo || '').trim();
    const cierre = fechaCierreCivil(venta);
    const registro = {
      fecha, codigo_eds: EDS,
      transaccion_id: id || null, transaccion_codigo: codigo || null,
      producto: 'DIESEL', litros: Number(venta.cantidad) || 0,
      precio_unitario: precioLiteral(venta.precio),
      fecha_cierre_copec: cierre.civil,
      fecha_cierre_copec_raw: cierre.raw,
      patente: String(venta.patente || venta.patenteVehiculo || venta.patenteReceptor || '').trim() || null,
    };
    // Una misma transacción repetida en el reporte se cuenta una sola vez.
    const clave = [id, String(venta.productoId || 'DIESEL').trim(), String(venta.surtidorId || ''), monto.toFixed(2)].join('|');
    if (filas.has(clave) && JSON.stringify(filas.get(clave)) !== JSON.stringify(registro)) {
      throw new Error('CopecFuel devolvió datos contradictorios para una carga STORAGE.');
    }
    filas.set(clave, registro);
  }
  return [...filas.values()];
}
