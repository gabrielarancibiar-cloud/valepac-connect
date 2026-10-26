import {EDS, CORTE, elaborarSnapshot, fechaHoraVenta} from './logic.js';

// Contrato de lectura recuperado del conector CopecFuel anterior de VALEPAC:
// POST /INTEGR1/transacciones, encabezado token y tipoReporte VENTA_COMBUSTIBLE.
// Esta peticion solo SOLICITA un reporte: no emite TAE ni modifica En Ruta.
const DEFAULT_URL = 'https://api2pr.copecfuel.com/INTEGR1/transacciones';
const MAX_ROWS = 50000;
const esTx = (v) => v && typeof v === 'object' && !Array.isArray(v) &&
  (v.transaccionId || v.transaccionCodigo) &&
  (v.productoId || v.productoDescripcion || v.productoNombre || v.cantidad !== undefined);

// El reporte de la API es anidado. Buscar arreglos de transacciones, nunca
// registros de medios de pago u otros tipos de reporte.
export function extraerVentasCombustible(payload) {
  const candidatos=[]; const vistos=new Set();
  function recorrer(v,depth=0) {
    if (!v || typeof v !== 'object' || depth > 12 || vistos.has(v)) return;
    vistos.add(v);
    if (Array.isArray(v)) {
      if (v.some(esTx)) {candidatos.push(v); return;}
      for (const x of v) recorrer(x,depth+1);
    } else {
      for (const [k,valor] of Object.entries(v)) {
        if (['errores','logs','auditoria','diagnostico','camposDisponibles','formasPago'].includes(k)) continue;
        recorrer(valor,depth+1);
      }
    }
  }
  recorrer(payload);
  const filas=candidatos.flat();
  if (!filas.length) throw new Error('CopecFuel no devolvio arreglo de ventas combustible reconocible');
  if (filas.length > MAX_ROWS || filas.some(x=>!esTx(x))) throw new Error('CopecFuel devolvio filas invalidas o demasiados registros');
  // Rechaza respuestas con filas de producto: esta consulta es exclusivamente
  // VENTA_COMBUSTIBLE. No asumir que el servidor cumplio tipoReporte.
  for (const x of filas) {
    if (x.categoriaNombre && String(x.categoriaNombre).toUpperCase() !== 'COMBUSTIBLE') throw new Error('CopecFuel incluyo ventas ajenas a combustible');
  }
  return filas;
}

// Inspect only report-level identifiers, never transaction rows or raw values.
// This cannot, by itself, prove that the API clientId belongs exclusively to EDS 40098.
export function diagnosticarOrigenReporte(body, clienteIdEsperado) {
  const estaciones = new Set();
  let clienteIdEnRespuesta = false;
  let clienteIdCoincide = false;
  let clienteIdDiferente = false;
  const campos = new Set();
  const visitados = new Set();
  const codigos = new Set(['codigoEds','codigo_eds','codigoEDS','codigoEstacion','codigo_estacion','estacionCodigo']);
  const clientes = new Set(['clienteId','cliente_id']);
  const metadatos = new Set(['data','datos','resultado','reporte','reportes','metadata','meta','origen','encabezado','contexto','estacion','estaciones','ubicacion','ubicaciones','cliente']);
  function leer(v, nivel=0) {
    if (!v || typeof v!=='object' || nivel>5 || visitados.has(v)) return;
    visitados.add(v);
    if (Array.isArray(v)) {
      if (v.length>50) return;
      for(const x of v) leer(x,nivel+1);
      return;
    }
    for (const [k, valor] of Object.entries(v)) {
      if (codigos.has(k) && (typeof valor==='string' || typeof valor==='number')) {
        campos.add(k);
        const id=String(valor).trim();
        if (id) estaciones.add(id);
      } else if (clientes.has(k) && (typeof valor==='string' || typeof valor==='number')) {
        campos.add(k);
        if(String(valor).trim()) {
          clienteIdEnRespuesta=true;
          if (String(valor).trim()===String(clienteIdEsperado).trim()) clienteIdCoincide=true;
          else clienteIdDiferente=true;
        }
      } else if (metadatos.has(k)) leer(valor,nivel+1);
    }
  }
  leer(body);
  return {
    codigoEdsDeclaradoEnSobre: estaciones.size>0,
    estacionesDistintasDeclaradas: estaciones.size,
    soloEds40098Declarada: estaciones.size===1 && estaciones.has(EDS),
    existeOtraEdsDeclarada: [...estaciones].some(x=>x!==EDS),
    clienteIdDeclaradoEnSobre: clienteIdEnRespuesta,
    clienteIdSolicitadoCoincide: clienteIdCoincide && !clienteIdDiferente,
    clienteIdDiferenteEnSobre: clienteIdDiferente,
    camposAcreditacionEnSobre:[...campos].sort(),
    advertencia:'ClienteId o prefijo de transaccion NO acreditan por si solos la EDS. Verificar exclusividad con Copec.'
  };
}

export async function consultarCopecFuel(fecha,{fetchImpl=fetch, env=process.env}={}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error('Fecha de consulta invalida');
  const token=String(env.COPEC_TOKEN||'').trim();
  const clienteId=String(env.COPEC_CLIENTE_ID||'').trim();
  if (!token) throw new Error('Falta COPEC_TOKEN en Vercel');
  if (!/^\d{12}$/.test(clienteId)) throw new Error('Falta COPEC_CLIENTE_ID de 12 digitos');
  const uri=new URL(env.COPEC_API_URL || DEFAULT_URL);
  if (uri.protocol!=='https:' || uri.username || uri.password) throw new Error('COPEC_API_URL debe ser HTTPS sin credenciales');
  // Endpoint oficial cerrado; NO abrir direccion hacia hosts internos.
  if (uri.hostname !== 'api2pr.copecfuel.com') throw new Error('Dominio API CopecFuel no validado; revisar antes de cambiar');
  let response;
  try {
    response=await fetchImpl(uri.toString(),{
      method:'POST',headers:{Accept:'application/json','Content-Type':'application/json',token},
      body:JSON.stringify({clienteId,turnoId:fecha.replace(/-/g,''),tipoReporte:['VENTA_COMBUSTIBLE']}),
      signal:AbortSignal.timeout(15000),redirect:'error'
    });
  } catch {throw new Error('No se pudo consultar CopecFuel: problema de red o timeout');}
  if (!response.ok) throw new Error(`CopecFuel HTTP ${response.status}`);
  let body;
  try {body=await response.json();} catch {throw new Error('CopecFuel no devolvio JSON valido');}
  if (body?.ok === false || body?.error || body?.success === false) throw new Error('CopecFuel rechazo el reporte de ventas');
  const filas=extraerVentasCombustible(body);
  return {fecha,filas,origen:diagnosticarOrigenReporte(body, clienteId)};
}
export async function snapshotCopecFuel(fecha,opts={}) {
  const {filas}=await consultarCopecFuel(fecha,opts);
  return elaborarSnapshot(filas,fecha,EDS);
}

// Diagnostico agregador, nunca registra filas, otros RUT, precios ni patentes.
// Observa exclusivamente las filas con hora verificable del dia antes del corte.
export function diagnosticarEds(filas, fecha, codigoEds=EDS) {
  const resultado={filasAntesDelCorte:0,eds40098Acreditada:0,edsAusente:0,edsDistinta:0,
    horaNoAcreditada:0,camposAlternativosEncontrados:[],
    codigosConPrefijo40098:0,codigosConOtroPrefijo:0,codigosAusentes:0};
  const alternativas=new Set();
  const candidatos=['estacionId','codigoEstacion','codigoEDS','idEds','id_eds','codigo_eds','estacion','edsId'];
  for (const fila of filas) {
    let t;
    try {t=fechaHoraVenta(fila);} catch {resultado.horaNoAcreditada++;continue;}
    if (t.fecha !== fecha || t.hora >= CORTE) continue;
    resultado.filasAntesDelCorte++;
    // Prefix is an investigative clue observed in old CopecFuel records,
    // not sufficient identity evidence to release a guide.
    const codigo=String(fila.transaccionCodigo ?? fila.transaccion_codigo ?? '').trim();
    if (!codigo) resultado.codigosAusentes++;
    else if (/^40098\d{10,}$/.test(codigo)) resultado.codigosConPrefijo40098++;
    else resultado.codigosConOtroPrefijo++;
    const valor=String(fila.codigoEds ?? fila.codigo_eds ?? '').trim();
    if (!valor) resultado.edsAusente++;
    else if (valor === String(codigoEds)) resultado.eds40098Acreditada++;
    else resultado.edsDistinta++;
    if (valor !== String(codigoEds)) {
      for (const nombre of candidatos) {
        if (fila[nombre] !== undefined && fila[nombre] !== null && String(fila[nombre]).trim()) alternativas.add(nombre);
      }
    }
  }
  resultado.camposAlternativosEncontrados=[...alternativas].sort();
  return resultado;
}
