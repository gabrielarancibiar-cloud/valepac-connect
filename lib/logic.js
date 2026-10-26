export const EDS = '40098';
export const RUT_COSEDUCAM = '969636301';
export const TZ = 'America/Santiago';
export const CORTE = '23:50:00';
const DIESEL_ID = '00000000000000000000000000000000001';

export function normalizar(v) { return String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^0-9a-z]+/gi, ' ').trim().replace(/\s+/g, ' ').toUpperCase(); }
export function rut(v) { return String(v ?? '').replace(/[^0-9k]/gi, '').toUpperCase(); }
export function num(v) { const n = Number(v); return Number.isFinite(n) ? n : NaN; }
export function redondearLitros(v) { const n = num(v); if (!(n > 0)) throw new Error('Litros no validos'); return Math.floor(Math.round(n * 1000) / 1000 + 0.5); }
export function horaChile(date = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone: TZ, year:'numeric', month:'2-digit', day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date).map(x => [x.type,x.value]));
  return {fecha:`${p.year}-${p.month}-${p.day}`,hora:`${p.hour}:${p.minute}:${p.second}`};
}

// La API CopecFuel recibida muestra transaccionFechaCierre como segundos de
// hora CIVIL del portal codificada en UTC. No transformarla una segunda vez
// a America/Santiago: eso cambia incluso el dia operacional en algunas filas.
// Validar esta semantica de manera independiente antes de habilitar emision.
export function fechaHoraVenta(fila) {
  if (fila.transaccionFechaCierre !== undefined && fila.transaccionFechaCierre !== null && fila.transaccionFechaCierre !== '') {
    const raw = Number(fila.transaccionFechaCierre);
    if (!Number.isFinite(raw) || raw <= 0) throw new Error('CopecFuel: transaccionFechaCierre invalida');
    const ms = raw < 1e12 ? raw * 1000 : raw;
    const d = new Date(ms);
    if (!Number.isFinite(d.getTime())) throw new Error('CopecFuel: timestamp invalido');
    const civil = d.toISOString();
    const fecha = civil.slice(0,10); const hora = civil.slice(11,19);
    if (fila.fecha && String(fila.fecha) !== fecha) throw new Error('CopecFuel: fecha de fila no coincide con fecha civil de cierre');
    if (fila.turnoId && String(fila.turnoId).replace(/\D/g,'').slice(0,8) !== fecha.replace(/-/g,'')) throw new Error('CopecFuel: turno y cierre no coinciden');
    return {fecha,hora};
  }
  // Contrato alternativo: ISO real con zona horaria explicita.
  const iso = fila.timestamp || fila.fechaHoraISO || fila.fecha_hora_iso || fila.fechaHora;
  if (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(iso)) {
    const d = new Date(iso); if (!Number.isFinite(d.getTime())) throw new Error('Fecha ISO invalida');
    return horaChile(d);
  }
  const fecha = fila.fechaChile || fila.fecha;
  const hora = fila.horaChile || fila.hora;
  if (typeof fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fecha) && typeof hora === 'string' && /^\d{2}:\d{2}(?::\d{2})?$/.test(hora)) {
    const h = hora.length === 5 ? `${hora}:00` : hora;
    if (h > '23:59:59') throw new Error('Hora de venta invalida');
    return {fecha,hora:h};
  }
  throw new Error('CopecFuel no informa fecha Y hora verificables; bloquear corte');
}

export function esDiesel(fila) {
  return String(fila.productoId || '').trim() === DIESEL_ID ||
    normalizar(fila.producto ?? fila.productoDescripcion ?? fila.productoNombre ?? fila.descripcionProducto).includes('DIESEL');
}
export function esCoseducamDiesel(fila) {
  const origen = fila.datos_origen ?? fila.datosOrigen ?? fila;
  const medios = [fila.forma_pago,fila.formaPago,fila.formaPagoNombre,origen.formaPagoNombre];
  if (!medios.some(v => normalizar(v) === 'STORAGE') || !esDiesel(fila)) return false;
  const clientes = [origen.clienteRutRut,origen.rutEmpresaReceptor,origen.rutCliente,origen.rut_cliente,origen['RUT CLIENTE']]
    .map(rut).filter(Boolean);
  if (clientes.length) return clientes.includes(RUT_COSEDUCAM);
  const razones = [origen.clienteRutRazonSocial,origen.razonSocialReceptor,origen.razonSocialCliente,origen['RAZON SOCIAL CLIENTE']];
  return razones.some(x => normalizar(x).includes('COSEDUCAM'));
}

export function elaborarSnapshot(filas, fecha, codigoEds=EDS) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !Array.isArray(filas)) throw new Error('Snapshot CopecFuel: fecha o datos invalidos');
  const consumos=[]; const ids=new Set();
  let totalFuente=0;
  for (const fila of filas) {
    if (!fila || typeof fila !== 'object') throw new Error('CopecFuel: fila no valida');
    const t = fechaHoraVenta(fila);
    // Regla absoluta: las operaciones fuera del dia o desde 23:50 no se
    // examinan ni afectan la validacion de EDS, los consumos o los precios.
    if (t.fecha !== fecha || t.hora >= CORTE) continue;
    if (String(fila.codigoEds || fila.codigo_eds || '').trim() !== String(codigoEds)) throw new Error('CopecFuel: fila sin EDS 40098 acreditada');
    if (fila.transaccionTipo && normalizar(fila.transaccionTipo) !== 'VENTA') continue;
    totalFuente++;
    const precio = num(fila.precioUnitario ?? fila.precioLitro ?? fila.precio);
    const volumen = num(fila.litros ?? fila.cantidad ?? fila.volumen);
    if (!esCoseducamDiesel(fila)) continue;
    const transaccion=String(fila.transaccion_id ?? fila.transaccionId ?? fila.transaccionCodigo ?? fila.transaccion_codigo ?? '').trim();
    if (!transaccion) throw new Error('Venta STORAGE COSEDUCAM sin identificador');
    if (ids.has(transaccion)) throw new Error('Transaccion COSEDUCAM repetida; revisar fuente');
    ids.add(transaccion);
    if (!(volumen > 0) || Math.abs(volumen * 1000 - Math.round(volumen * 1000)) > 0.000001) {
      throw new Error('Venta STORAGE COSEDUCAM sin litros positivos o con precision superior a mililitro');
    }
    // Precio de ESA MISMA carga STORAGE: no tomar la moda de ventas
    // asistidas ni el precio sugerido por TAE.
    if (!Number.isSafeInteger(precio) || precio <= 0) {
      throw new Error('Venta STORAGE COSEDUCAM sin precio unitario CLP entero y positivo');
    }
    consumos.push({fecha,codigo_eds:codigoEds,transaccion_id:transaccion,
      litros:volumen,hora_venta:t.hora,precio_unitario:precio});
  }
  if (!totalFuente) throw new Error('CopecFuel sin ventas verificables para el corte');
  if (!consumos.length) throw new Error('No hay consumos STORAGE Diesel COSEDUCAM acreditados');
  // Precio TAE = precio mas alto SOLO entre las cargas STORAGE validas.
  // Una carga ausente/no acreditada bloquea el snapshot antes de emitir.
  const precio = consumos.reduce((max,r)=>Math.max(max,r.precio_unitario),0);
  const litros = Math.round(consumos.reduce((sum,r) => sum+r.litros,0)*1000)/1000;
  return {fecha,codigoEds,litros,litrosGuia:redondearLitros(litros),precio,consumos,totalFuente};
}
