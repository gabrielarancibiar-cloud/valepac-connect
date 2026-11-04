// Conciliación COSEDUCAM: exclusivamente lectura CopecFuel/En Ruta.
// No consulta coseducam_guias/jobs ni envía autorizar-consumo/modificarPedido.
import { clasificarConsumosV2 } from './comercialV2.js';

export const EDS = '40098';
const RUT = '969636301';
// No equiparar ENTREGADO/CERRADO a retiro TAE confirmado sin evidencia del proveedor.
const FINALES = new Set(['CONFIRMADA','CONFIRMADO','RETIRO CONFIRMADO','GUIA CONFIRMADA','CONFIRMADO EN RUTA','CONFIRMADA EN RUTA']);
const EMITIDAS = new Set(['PENDIENTE','EMITIDA','EMITIDO','CREADA','CREADO','PENDIENTE CONFIRMACION','ESPERANDO CONFIRMACION']);

const texto = (v) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase().replace(/\s+/g,' ');
const rut = (v) => texto(v).replace(/[^0-9K]/g,'');
const filaValor = (fila, alternativas) => alternativas.map(x=>fila[x]).find(x => String(x ?? '').trim()) ?? '';
function fechaIso(valor) {
  const t = String(valor ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0,10);
  const m=t.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}` : null;
}
function litrosChile(valor) {
  if (typeof valor === 'number') return valor;
  const raw = String(valor ?? '').trim();
  if (!raw) return NaN;
  const n = Number(raw.includes(',') ? raw.replace(/\./g,'').replace(',','.') : raw.replace(/(?<=\d)\.(?=\d{3}(?:\D|$))/g,''));
  return Number.isFinite(n) ? n : NaN;
}
export function redondearLitros(valor) {
  const n=Number(valor);
  return Number.isFinite(n) && n>=0 ? Math.floor(Math.round(n*1000)/1000+0.5) : null;
}
export function parsearExcelEnRutaTsv(textoTsv) {
  const lineas=String(textoTsv??'').replace(/^\uFEFF/,'').split(/\r?\n/).filter(l=>l.trim());
  if (lineas.length===0) return {columnas:[],filas:[]};
  const columnas=lineas[0].split('\t').map(texto);
  const filas=lineas.slice(1).map(l=>Object.fromEntries(columnas.map((c,i)=>[c,(l.split('\t')[i]??'').trim()])));
  return {columnas,filas};
}
export function normalizarGuiaEnRuta(fila) {
  // FECHA ESTADO describe la transición, NO la fecha comercial de autorización.
  const fechaOriginal=fechaIso(filaValor(fila,[
    'FECHA AUTORIZACION','FECHA AUTORIZACIÓN','FECHA EMISION','FECHA EMISIÓN',
    'FECHA CREACION','FECHA CREACIÓN','FECHA PEDIDO','FECHA INGRESO'
  ]));
  const rutExterno=rut(filaValor(fila,['RUT CLIENTE','RUT DESTINATARIO','RUT RECEPTOR','RUT','RUT EMPRESA']));
  const destinatario=texto(filaValor(fila,['DESTINATARIO','CLIENTE','RAZON SOCIAL','RAZÓN SOCIAL','RAZON SOCIAL CLIENTE','RECEPTOR']));
  const estacion=String(filaValor(fila,['ESTACION','ESTACION ORIGEN','ID ESTACION','CODIGO EDS'])).trim();
  const estacionValida=!estacion || estacion.replace(/[^0-9]/g,'') === EDS;
  const clienteValido=estacionValida && (rutExterno === RUT || destinatario.includes('COSEDUCAM')) &&
    (!rutExterno || rutExterno === RUT) && (!destinatario || destinatario.includes('COSEDUCAM'));
  const producto=texto(filaValor(fila,['PRODUCTO','DESCRIPCION PRODUCTO','DESCRIPCIÓN PRODUCTO']));
  const productoValido=['D','DIESEL','PETROLEO DIESEL','DIESEL A1'].includes(producto);
  const estado=texto(filaValor(fila,['ESTADO','ESTADO PEDIDO','ESTADO ENTREGA']));
  const guia=String(filaValor(fila,['GUIA','GUIA TAE','NUMERO GUIA','NRO GUIA','N GUIA','N° GUIA','GUIA DESPACHO'])).trim();
  const pedido=String(filaValor(fila,['NUMERO PEDIDO','NRO PEDIDO','PEDIDO'])).trim();
  const dte=String(filaValor(fila,['DTE'])).trim();
  const litros=litrosChile(filaValor(fila,['LITROS ENTREGADOS','LITROS','VOLUMEN ENTREGADO','VOLUMEN','UNIDAD']));
  return {fechaOrigen:fechaOriginal,fechaEstado:fechaIso(filaValor(fila,['FECHA ESTADO'])),
    clienteValido,productoValido,estado,final:FINALES.has(estado),guia,pedido,dte,
    litros:Number.isFinite(litros)?litros:null};
}

export function conciliarCoseducam({periodo,consumos,filasEnRuta,enRutaDisponible=true,ahora=new Date(),codigoEds=EDS}) {
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodo)) throw new Error('Periodo inválido');
  const diasMes=new Date(Date.UTC(Number(periodo.slice(0,4)),Number(periodo.slice(5)),0)).getUTCDate();
  const hoyChile=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit'}).format(ahora);
  const filas=Array.isArray(consumos)?consumos:[];
  const comprobaciones=(Array.isArray(filasEnRuta)?filasEnRuta:[]).map(normalizarGuiaEnRuta);
  const dias=[];
  const guiaAsignada=new Set();
  for(let n=1;n<=diasMes;n++) {
    const fecha=`${periodo}-${String(n).padStart(2,'0')}`;
    if(fecha>hoyChile) break;
    const comercial=clasificarConsumosV2(fecha,filas.filter(x=>x.fecha===fecha));
    if(comercial.litros<=0 && comercial.registros===0) continue;
    const esperados=redondearLitros(comercial.litros);
    const candidatos=comprobaciones.filter(g=>g.clienteValido && g.productoValido && g.fechaOrigen===fecha);
    const validas=candidatos.filter(g=>g.guia && g.final && g.litros!==null && Math.abs(g.litros-esperados)<=0.01);
    const emitidas=candidatos.filter(g=>g.guia && !g.final);
    let estado='SIN_GUIA_ENRUTA';let coincidencia=null;
    if(!enRutaDisponible) estado='ENRUTA_NO_DISPONIBLE';
    else if(!comercial.completo) estado='DATOS_COPECFUEL_INCOMPLETOS';
    else if(candidatos.filter(g=>g.final && g.guia).length>1) estado='REVISION_MULTIPLES_GUIAS';
    else if(validas.length===1 && guiaAsignada.has(validas[0].guia)) estado='REVISION_GUIA_REPETIDA';
    else if(validas.length===1) {
      coincidencia=validas[0];guiaAsignada.add(coincidencia.guia);estado='RETIRO_TAE_OK';
    } else if(candidatos.some(g=>g.final && g.guia && g.litros!==null)) estado='DIFERENCIA_LITROS';
    else if(emitidas.length>1) estado='REVISION_MULTIPLES_GUIAS';
    else if(emitidas.length) {
      coincidencia=emitidas[0];
      if(coincidencia.litros!==null && Math.abs(coincidencia.litros-esperados)>0.01)
        estado='DIFERENCIA_LITROS';
      else if(coincidencia.litros===null) estado='ENRUTA_DATOS_INSUFICIENTES';
      else estado=EMITIDAS.has(coincidencia.estado)?'GUIA_EMITIDA_NO_CONFIRMADA':'ENRUTA_ESTADO_NO_ACREDITADO';
    }
    else if(candidatos.length || comprobaciones.some(g=>g.clienteValido && g.productoValido && !g.fechaOrigen)) estado='ENRUTA_DATOS_INSUFICIENTES';
    else if(fecha===hoyChile) estado='DIA_EN_CURSO_O_SIN_GUIA';
    dias.push({fecha,estado,consumo:{litros:comercial.litros,litrosEsperados:esperados,
       precioTae:comercial.precioTae,cargas:comercial.registros,datosCompletos:comercial.completo,
       detalle:comercial.elegibles.map(x=>({transaccion:x.transaccion_codigo||x.transaccion_id,
         litros:Number(x.litros)||0,patente:x.patente||null}))},
       guia:coincidencia ? {numeroGuia:coincidencia.guia,numeroPedido:coincidencia.pedido,
         litros:coincidencia.litros,estadoEnRuta:coincidencia.estado,fechaEstado:coincidencia.fechaEstado}:null,
       candidatas:candidatos.length,
       observacion: estado==='ENRUTA_DATOS_INSUFICIENTES'
         ? 'En Ruta no informó guía, fecha de autorización, litros o estado verificables.' : null});
  }
  return {periodo,codigoEds,fuentes:{copecfuel:'COPECFUEL_DATALAKE_STORAGE',enRuta:enRutaDisponible?'ENRUTA_EXCEL_SOLO_LECTURA':'ENRUTA_NO_DISPONIBLE'},
    resumen:{litros:dias.reduce((a,d)=>a+d.consumo.litros,0),cargas:dias.reduce((a,d)=>a+d.consumo.cargas,0),
      diasConConsumo:dias.length,retirosOk:dias.filter(d=>d.estado==='RETIRO_TAE_OK').length,
      emitidasSinConfirmar:dias.filter(d=>d.estado==='GUIA_EMITIDA_NO_CONFIRMADA').length,
      requierenRevision:dias.filter(d=>!['RETIRO_TAE_OK','GUIA_EMITIDA_NO_CONFIRMADA'].includes(d.estado)).length},
      dias,soloLectura:true};
}
