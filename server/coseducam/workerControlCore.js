// Puerta privada COSEDUCAM: operaciones estrictamente enumeradas, NO RPC genérico.
import { createHash, timingSafeEqual } from 'node:crypto';

const FECHA_INICIO = '2026-10-15';
const EDS = '40098';
const PROTOCOLO = 'coseducam-control-v1';

function chileno(ahora) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(ahora);
  const p = Object.fromEntries(partes.map(({type,value}) => [type,value]));
  return { fecha: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}:${p.second}` };
}
function diaAnterior(fecha) {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate()-1);
  return d.toISOString().slice(0,10);
}
function coinciden(a,b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length < 32 || b.length < 32) return false;
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}
function fechaValida(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(`${v}T12:00:00Z`)) && new Date(`${v}T12:00:00Z`).toISOString().slice(0,10) === v; }
function objeto(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function json(res,status,payload) {
  res.setHeader('Cache-Control','private, no-store');
  return res.status(status).json({ protocolo: PROTOCOLO, ...payload });
}
function columnasExactas(valor, permitidas) {
  return objeto(valor) && Object.keys(valor).every(k => permitidas.includes(k));
}

export function crearControlHandler({ rpc, tabla, secreto, ahora = () => new Date() }) {
  return async function handler(req,res) {
    res.setHeader('Cache-Control','private, no-store');
    if (req.method !== 'POST') return json(res,405,{ok:false,accion:'metodo_no_permitido'});
    if (!coinciden(req.headers?.['x-valepac-worker-secret'],secreto()))
      return json(res,403,{ok:false,accion:'worker_no_autorizado'});
    const body = req.body;
    if (!objeto(body) || JSON.stringify(body).length > 2048 ||
        typeof body.accion !== 'string')
      return json(res,400,{ok:false,accion:'solicitud_invalida'});
    const reloj = chileno(ahora());
    try {
      if (body.accion === 'diagnostico_rpc_cierre_v2') {
        if (!columnasExactas(body,['accion'])) return json(res,400,{ok:false,accion:'solicitud_invalida'});
        // La primera comprobación de la SQL rechaza esta fecha antes de cualquier DML.
        const {data,error} = await rpc('coseducam_cierre_iniciar_v2',{p_fecha:'2026-10-14'});
        if (error) return json(res,503,{ok:false,accion:'rpc_no_disponible',codigoRpc:String(error.code||'').slice(0,16)});
        if (data?.ok === false && data?.estado === 'FECHA_NO_AUTORIZADA')
          return json(res,200,{ok:true,accion:'rpc_cierre_accesible_sin_escritura',estadoRpc:data.estado,modificoDatos:false});
        return json(res,503,{ok:false,accion:'rpc_respuesta_inesperada',modificoDatos:false});
      }
      if (body.accion === 'cierre_iniciar_v2') {
        if (!columnasExactas(body,['accion','fecha']) || !fechaValida(body.fecha))
          return json(res,400,{ok:false,accion:'solicitud_invalida'});
        if (body.fecha !== reloj.fecha || body.fecha < FECHA_INICIO || reloj.hora < '23:50:00')
          return json(res,409,{ok:false,accion:'fuera_de_horario',modificoDatos:false});
        const {data,error} = await rpc('coseducam_cierre_iniciar_v2',{p_fecha:body.fecha});
        if (error || !objeto(data)) return json(res,503,{ok:false,accion:'rpc_no_disponible'});
        if (data.ok === true && data.estado === 'EJECUTANDO' &&
            typeof data.runId === 'string' && /^[0-9a-f-]{36}$/i.test(data.runId))
          return json(res,200,{ok:true,accion:'cierre_reservado',estado:data.estado,fecha:body.fecha,runId:data.runId});
        return json(res,409,{ok:false,accion:'cierre_no_iniciado',estado:String(data.estado||'SIN_ESTADO').slice(0,50),
          estadoAnterior: data.estadoAnterior || null});
      }
      if (body.accion === 'cierre_finalizar_v2') {
        if (!columnasExactas(body,['accion','fecha','runId','sha256','capturadoEn','procesadoEn','transacciones','lineas','error']) ||
            !fechaValida(body.fecha) || body.fecha < FECHA_INICIO ||
            !(body.fecha === reloj.fecha || (body.fecha === diaAnterior(reloj.fecha) && reloj.hora <= '00:30:00')) ||
            typeof body.runId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.runId))
          return json(res,400,{ok:false,accion:'solicitud_invalida'});
        const fallo = body.error;
        const conError = typeof fallo === 'string' && fallo.trim().length > 0 && fallo.length <= 500;
        const conEvidencia = fallo === null && typeof body.sha256 === 'string' && /^[0-9a-f]{64}$/.test(body.sha256) &&
          typeof body.capturadoEn === 'string' && Number.isFinite(Date.parse(body.capturadoEn)) &&
          typeof body.procesadoEn === 'string' && Number.isFinite(Date.parse(body.procesadoEn)) &&
          Number.isSafeInteger(body.transacciones) && body.transacciones > 0 &&
          Number.isSafeInteger(body.lineas) && body.lineas >= 0;
        if (!conError && !conEvidencia) return json(res,400,{ok:false,accion:'evidencia_invalida'});
        const {data,error} = await rpc('coseducam_cierre_finalizar_v2',{
          p_fecha:body.fecha,p_run_id:body.runId,
          p_sha256:conEvidencia?body.sha256:null,
          p_capturado_en:conEvidencia?body.capturadoEn:null,
          p_procesado_en:conEvidencia?body.procesadoEn:null,
          p_transacciones:conEvidencia?body.transacciones:null,
          p_lineas:conEvidencia?body.lineas:null,
          p_error:conError?fallo:null,
        });
        if (error || !objeto(data)) return json(res,503,{ok:false,accion:'rpc_no_disponible'});
        if (data.ok === true && ['VALIDADO','SIN_CONSUMOS'].includes(data.estado))
          return json(res,200,{ok:true,accion:'cierre_finalizado',estado:data.estado,consumosElegibles:data.consumosElegibles});
        return json(res,409,{ok:false,accion:'cierre_requiere_revision',estado:data.estado||'REVISION_REQUERIDA'});
      }
      if (body.accion === 'enruta_pendiente_v2') {
        if (!columnasExactas(body,['accion','fecha']) || !fechaValida(body.fecha))
          return json(res,400,{ok:false,accion:'solicitud_invalida'});
        const fechaPermitida = reloj.hora >= '23:52:00' ? reloj.fecha :
          reloj.hora <= '00:25:59' ? diaAnterior(reloj.fecha) : null;
        if (body.fecha !== fechaPermitida || body.fecha < FECHA_INICIO)
          return json(res,409,{ok:false,accion:'fuera_de_ventana',modificoDatos:false});
        const {data:trabajos,error:ej} = await tabla('coseducam_jobs')
          .select('id,estado,etapa_previa,numero_guia,intentos_enruta,max_intentos_enruta')
          .eq('fecha',body.fecha).eq('codigo_eds',EDS).limit(2);
        if (ej || !Array.isArray(trabajos)) return json(res,503,{ok:false,accion:'lectura_job_no_acreditada'});
        if (trabajos.length !== 1 || trabajos[0].estado !== 'esperando_enruta' ||
            trabajos[0].etapa_previa !== 'tae_registrada' ||
            !/^\d{5,20}$/.test(String(trabajos[0].numero_guia||'')) ||
            !Number.isInteger(Number(trabajos[0].intentos_enruta)) ||
            Number(trabajos[0].intentos_enruta) >= Math.min(10,Number(trabajos[0].max_intentos_enruta)||10))
          return json(res,200,{ok:true,accion:'sin_trabajo_enruta_pendiente',pendiente:false});
        const numeroGuia=String(trabajos[0].numero_guia);
        const {data:guias,error:eg} = await tabla('coseducam_guias')
          .select('id,estado,numero_guia').eq('fecha',body.fecha).eq('codigo_eds',EDS)
          .eq('numero_guia',numeroGuia).limit(2);
        if (eg || !Array.isArray(guias)) return json(res,503,{ok:false,accion:'lectura_guia_no_acreditada'});
        if (guias.length !== 1 || guias[0].estado !== 'creada' ||
            !(typeof guias[0].id === 'number' && Number.isSafeInteger(guias[0].id) ||
              typeof guias[0].id === 'string' && (/^[1-9]\d{0,18}$/.test(guias[0].id) ||
              /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(guias[0].id))))
          return json(res,409,{ok:false,accion:'guia_no_acreditada'});
        return json(res,200,{ok:true,accion:'enruta_pendiente',pendiente:true,
          fecha:body.fecha,numeroGuia,guiaId:String(guias[0].id)});
      }
      return json(res,400,{ok:false,accion:'accion_no_permitida'});
    } catch (error) {
      // No propagar consultas, cadenas de conexión, headers o credenciales.
      return json(res,503,{ok:false,accion:'control_no_disponible'});
    }
  };
}
