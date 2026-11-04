// Consulta de seguimiento COSEDUCAM por el endpoint EXISTENTE de conciliación.
// Fuentes: consumos CopecFuel archivados + reporte En Ruta, sin escrituras.
import { conciliarCoseducam, parsearExcelEnRutaTsv } from './seguimientoSoloLectura.js';

const EDS='40098';
function fechaHoyChile() {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
function desplazar(fecha,dias) {
  const d=new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate()+dias);
  return d.toISOString().slice(0,10);
}
async function leerConsumos(supabaseAdmin,desde,hasta) {
  const todas=[];
  for(let desdeFila=0;desdeFila<100000;desdeFila+=1000) {
    const {data,error}=await supabaseAdmin.from('coseducam_consumos')
      .select('fecha,codigo_eds,transaccion_id,transaccion_codigo,producto,litros,patente,precio_unitario,fecha_cierre_copec,fecha_cierre_copec_raw')
      .gte('fecha',desde).lte('fecha',hasta).eq('codigo_eds',EDS)
      .order('fecha',{ascending:true}).range(desdeFila,desdeFila+999);
    if(error) throw new Error(`Lectura CopecFuel no disponible: ${error.message}`);
    const filas=Array.isArray(data)?data:[];
    todas.push(...filas);
    if(filas.length<1000) return todas;
  }
  throw new Error('La lectura CopecFuel supera el límite de paginación segura.');
}
export async function consultarSeguimientoCoseducam({periodo,supabaseAdmin,obtenerExcelEnRuta}) {
  const mes=String(periodo||fechaHoyChile().slice(0,7));
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) {
    const error=new Error('Periodo inválido (AAAA-MM).'); error.status=400; throw error;
  }
  const hoy=fechaHoyChile();
  const desde=`${mes}-01`;
  const dias=new Date(Date.UTC(Number(mes.slice(0,4)),Number(mes.slice(5)),0)).getUTCDate();
  const fin=desplazar(desde,dias-1);
  if(desde>hoy) {const error=new Error('Mes futuro no disponible.');error.status=400;throw error;}
  const consumos=await leerConsumos(supabaseAdmin,desde,fin);
  let filasEnRuta=[],enRutaDisponible=true,advertenciaEnRuta=null,columnasEnRuta=[];
  try {
    // Estados posteriores no cambian la fecha original de autorización.
    const finMasSiete=desplazar(fin,7);
    const finConsulta=finMasSiete<hoy?finMasSiete:hoy;
    const {bytes}=await obtenerExcelEnRuta({fechaDesde:desde,fechaHasta:finConsulta,codigoEds:EDS});
    const tsv=new TextDecoder('windows-1252').decode(bytes);
    const reporte=parsearExcelEnRutaTsv(tsv);
    const tiene=(nombres)=>nombres.some(c=>reporte.columnas.includes(c));
    if(!reporte.columnas.includes('ESTADO') || !reporte.columnas.includes('PRODUCTO') ||
        !tiene(['LITROS ENTREGADOS','LITROS','VOLUMEN','VOLUMEN ENTREGADO']) ||
        !tiene(['GUIA','GUIA TAE','NUMERO GUIA','NRO GUIA','N GUIA','N° GUIA','GUIA DESPACHO']) ||
        !tiene(['FECHA AUTORIZACION','FECHA EMISION','FECHA CREACION','FECHA PEDIDO','FECHA INGRESO']) ||
        !tiene(['RUT CLIENTE','RUT DESTINATARIO','RUT RECEPTOR','RUT','RUT EMPRESA','DESTINATARIO','CLIENTE','RAZON SOCIAL','RAZON SOCIAL CLIENTE','RECEPTOR'])) {
      throw new Error('Columnas de En Ruta no acreditadas.');
    }
    filasEnRuta=reporte.filas;
    columnasEnRuta=reporte.columnas;
  } catch(err) {
    enRutaDisponible=false;
    advertenciaEnRuta='No fue posible acreditar el reporte En Ruta. No se marcará ningún retiro como OK.';
    console.warn('COSEDUCAM seguimiento En Ruta no disponible:',err?.message||'error');
  }
  const resultado=conciliarCoseducam({periodo:mes,consumos,filasEnRuta,enRutaDisponible});
  return {...resultado,verificadoEn:new Date().toISOString(),advertenciaEnRuta,
    diagnostico:{columnasEnRuta,filasEnRuta:filasEnRuta.length},
    alcance:'SOLO_LECTURA_COPECFUEL_ENRUTA'};
}
