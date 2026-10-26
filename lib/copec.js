import {EDS,RUT_COSEDUCAM,normalizar,rut,num,redondearLitros} from './logic.js';
export {snapshotCopecFuel} from './copecfuel.js';

export class EsperarEnRuta extends Error {}
const REQUERIDO = (name) => {const x=process.env[name]; if(!x || x.startsWith('REEMPLAZAR'))throw new Error(`Falta variable ${name}`); return x;};
async function solicitud(url,options={},timeout=20000) {
  const res=await fetch(url,{...options,signal:AbortSignal.timeout(timeout),redirect:'error'});
  const raw=await res.text();
  if(!res.ok) throw new Error(`Proveedor externo HTTP ${res.status}: ${raw.slice(0,180)}`);
  return raw;
}
async function json(url,options={},timeout=20000){const raw=await solicitud(url,options,timeout);try{return JSON.parse(raw);}catch{throw new Error('Proveedor externo no devolvio JSON valido');}}

const TAE_BASE='https://tct-tae-api.copec.cl/tct-tae';
async function tae(path,body) {
  const token=REQUERIDO('TCT_TAE_TOKEN');
  return json(`${TAE_BASE}${path}`,{method:body?'POST':'GET',headers:{Accept:'application/json',Origin:'https://tct-tae.copec.cl',Referer:'https://tct-tae.copec.cl/',token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
}
function lista(v){return Array.isArray(v)?v:[];}
async function configuracionGuia() {
  const clientePayload=await tae('/obtener-clientes-autorizacion?RUT=96963630');
  const cliente=lista(clientePayload?.data?.clientes)[0];
  if(!cliente?.codigo_sin_digito)throw new Error('No se obtuvo cliente COSEDUCAM desde TAE');
  const codigo=encodeURIComponent(cliente.codigo_sin_digito);
  const [tp,sp,fp]=await Promise.all([
    tae(`/obtener-tarjetas-cliente?CODCLIENTE=${codigo}&PRODUCTO=TAE&IDEDS=${EDS}`),
    tae(`/obtener-subproductos?CODPRODUCTO=001&IDEDS=${EDS}`),
    tae(`/obtener-flete?RUT=96963630&IDEDS=${EDS}`),
  ]);
  const preferida=REQUERIDO('COSEDUCAM_TARJETA_TAE');
  const tarjeta=lista(tp?.data?.tarjetas).find(x=>x.numero_tarjeta===preferida);
  const producto=lista(sp?.data?.subproductos).find(x=>String(x.codigo)==='001');
  if(!tarjeta || !producto || !(num(producto.precio)>0))throw new Error('Tarjeta TAE, Diesel o precio Portal no validos');
  if(!(num(fp?.data?.flete)>=0))throw new Error('Flete de portal no valido');
  return {cliente,tarjeta,producto,flete:Math.round(num(fp.data.flete))};
}
export async function emitirGuiaTAE({litrosGuia,precio,fecha}) {
  if(process.env.OPERATIONS_ENABLED!=='true' || process.env.TAE_ENABLED!=='true')throw new Error('Emision TAE desactivada');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !(Number.isInteger(litrosGuia)&&litrosGuia>0) || !(Number.isInteger(precio)&&precio>0))throw new Error('Datos de guia invalidos');
  const c=await configuracionGuia();
  const body={
    id_eds:EDS,codigo_cliente:String(parseInt(c.cliente.codigo_sin_digito,10)),numero_tarjeta:c.tarjeta.numero_tarjeta,
    cod_producto:'001',precio,
    rut:REQUERIDO('COPEC_RUT_CONCESIONARIO'),nombre_rut:REQUERIDO('COPEC_NOMBRE_CONCESIONARIO'),
    cod_motivo:'0002',monto:Math.ceil(litrosGuia*precio),unidad:litrosGuia.toFixed(2),
    cod_subproducto:'001',direccion:REQUERIDO('COSEDUCAM_DIRECCION'),cod_comuna:REQUERIDO('COSEDUCAM_COD_COMUNA'),
    flete:c.flete,orden_compra:'',comuna:REQUERIDO('COSEDUCAM_COMUNA'),tae_retiro:false,
  };
  // UNICO envio mutador. Ante respuesta incierta se exige revision humana.
  const respuesta=await tae('/autorizar-consumo',body);
  const data=respuesta?.data;
  if(!data || typeof data.error!=='string' || data.error)throw new Error(data?.error||'Resultado TAE incierto: revisar externo');
  const numeroGuia=String(data.numero_guia||'').trim();const codigoAutorizacion=String(data.codigo_autorizacion||'').trim();
  if(!numeroGuia || !codigoAutorizacion)throw new Error('TAE no devolvio identificadores completos: revisar externo');
  return {numeroGuia,codigoAutorizacion,precioPortal:Math.round(num(c.producto.precio))};
}
const ENRUTA_BASE='https://enrutacopec.cl';
async function rutaEnRuta(parametros) {
  const cookie=process.env.ENRUTA_COOKIE;
  const raw=await solicitud(`${ENRUTA_BASE}/fetch/elementos/f_MonitorEntrega.aspx`,{
    method:'POST',headers:{Accept:'*/*','Content-Type':'application/x-www-form-urlencoded; charset=UTF-8',Origin:ENRUTA_BASE,Referer:`${ENRUTA_BASE}/MonitorEntrega.aspx`,'X-Requested-With':'XMLHttpRequest',...(cookie?{Cookie:cookie}:{})},body:new URLSearchParams(parametros).toString()
  });
  return raw;
}
const partes=(raw)=>raw.replace(/Â§/g,'§').split('§').map(x=>x.trim());
const chileNum=(v)=>{const x=num(String(v).replace(/\./g,'').replace(',','.'));return x;};
export async function prevalidarEnRuta(guia) {
  const consulta=async(valor)=>{
    const raw=await rutaEnRuta({accion:'gMonitorPedido',hr:'',pedido:'',destinatario:'',estacion:EDS,guia:valor,fini:'',ffini:'',usuario:EDS,_search:'false',nd:String(Date.now()),rows:'100',page:'1',sidx:'CONVERT(DATETIME,FECHA,105)',sord:'desc'});
    try{const r=JSON.parse(raw);if(!Array.isArray(r.rows))throw new Error('Sin filas');return r.rows;}catch{if(valor)return [];throw new Error('En Ruta devolvio listado no valido');}
  };
  const buscar=(filas)=>filas.find(x=>String(x.GUIA||'').trim()===guia.numero_guia && String(x.ESTACION||'').trim()===EDS);
  const pedido=buscar(await consulta(guia.numero_guia))||buscar(await consulta(''));
  if(!pedido?.NUMEROPEDIDO)throw new EsperarEnRuta('Guia aun no aparece en En Ruta');
  const raw=await rutaEnRuta({accion:'infoModificar',id:String(pedido.NUMEROPEDIDO)});
  const p=partes(raw);
  if(p[0]!=='1'||p.length<21)throw new Error('Detalle En Ruta incompleto: requiere revision');
  const detalle={rut:p[1],razon:p[2],guia:p[5],tarjeta:p[6],codigoCliente:p[7],codigoProducto:p[8],volumen:chileNum(p[9]),precio:chileNum(p[10]),direccion:p[12],flete:chileNum(p[14]),comuna:p[15],codigoInstalacion:p[16],responsable:p[17],fechaAutorizacion:p[18],horaAutorizacion:p[19],codigoAutorizacion:p[20]};
  if(rut(detalle.rut)!==RUT_COSEDUCAM || !normalizar(detalle.razon).includes('COSEDUCAM'))throw new Error('Cliente En Ruta no coincide');
  if(!['D','DIESEL'].includes(normalizar(pedido.PRODUCTO)))throw new Error('Producto En Ruta no es Diesel');
  if(detalle.guia!==guia.numero_guia || !detalle.codigoAutorizacion || !Number.isFinite(detalle.volumen) || Math.abs(detalle.volumen-redondearLitros(guia.litros))>0.01)throw new Error('Guia, autorizacion o litros En Ruta no coinciden');
  // Coincidencia de codigos solo si la API usa exactamente la misma identidad (se conservan para auditoria).
  return {numeroPedido:String(pedido.NUMEROPEDIDO),detalle};
}
export async function confirmarEnRuta(guia,prevalidado) {
  if(process.env.OPERATIONS_ENABLED!=='true'||process.env.ENRUTA_ENABLED!=='true')throw new Error('Confirmacion En Ruta desactivada');
  const d=prevalidado.detalle;
  const raw=await rutaEnRuta({accion:'modificarPedido',codclie:d.codigoCliente,codauto:d.codigoAutorizacion,comuna:d.comuna,flete:String(d.flete),desinta:d.responsable,despro:'DIESEL',direccion:d.direccion,fechaauto:d.fechaAutorizacion,horaauto:d.horaAutorizacion,codinsta:d.codigoInstalacion,pedido:prevalidado.numeroPedido,guia:guia.numero_guia,precio:String(d.precio),codprod:d.codigoProducto||'001',razon:d.razon,rut:d.rut,tarjeta:d.tarjeta,volumen:String(d.volumen),tipo:process.env.COSEDUCAM_ENRUTA_TIPO||'5',patente:'',email:'',rutr:''});
  const ps=partes(raw);
  if(ps[0]!=='1'||!normalizar(ps.slice(1).join(' ')).includes('CONFIRMACION EXITOSA'))throw new Error('Confirmacion no acreditada: revisar portal antes de intentar de nuevo');
  return {numeroPedido:prevalidado.numeroPedido};
}
