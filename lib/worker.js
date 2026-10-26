import {db,obligatorio} from './db.js';
import {horaChile} from './logic.js';
import {snapshotCopecFuel,emitirGuiaTAE,prevalidarEnRuta,confirmarEnRuta,EsperarEnRuta} from './copec.js';

const EDS='40098';
const ahora=(min=0)=>new Date(Date.now()+min*60000).toISOString();
const errorTexto=e=>String(e instanceof Error?e.message:e).slice(0,500);
async function evento(fecha,etapa,mensaje){try{await obligatorio(db().from('coseducam_eventos').insert({fecha,etapa,mensaje:String(mensaje).slice(0,500)}));}catch(e){console.error('Auditoria no disponible:',errorTexto(e));}}
async function actualizarJob(j,estadoActual,update,conLease=true){
  let q=db().from('coseducam_jobs').update({...update,actualizado_en:new Date().toISOString()}).eq('id',j.id).eq('estado',estadoActual);
  if(conLease)q=q.eq('token_lease',j.token_lease);
  const filas=await obligatorio(q.select('id,estado'));
  if(filas.length!==1)throw new Error('Cambio de estado no confirmado: revision manual');
}
async function cambiarGuia(id,estado,update){
  const filas=await obligatorio(db().from('coseducam_guias').update(update).eq('id',id).eq('estado',estado).select('id'));
  if(filas.length!==1)throw new Error('Actualizacion de guia no confirmada; requiere revision manual');
}
async function revisar(j,estadoActual,e,conLease=true){
  await evento(j.fecha,'revision_requerida',errorTexto(e));
  await actualizarJob(j,estadoActual,{estado:'revision_requerida',ultimo_error:errorTexto(e),token_lease:null,lease_hasta:null},conLease);
  return {accion:'revision_requerida',fecha:j.fecha,detalle:errorTexto(e)};
}
export async function ejecutar() {
  // Interlock doble: despliegue inicial no puede escribir en proveedores.
  if(['OPERATIONS_ENABLED','TAE_ENABLED','ENRUTA_ENABLED'].some(k=>process.env[k]!=='true'))return {accion:'desactivado',modo:'solo_lectura',detalle:'Requiere habilitacion explicita de tres flags'};
  const j=await obligatorio(db().rpc('coseducam_tomar_trabajo'));
  if(!j)return {accion:'sin_trabajo',chile:horaChile()};
  if(j.codigo_eds!==EDS)throw new Error('EDS no autorizada');
  if(j.estado==='pendiente') {
    // El unico instante valido para preparar una fotografia del dia es ese mismo dia.
    if(horaChile().fecha!==j.fecha) return revisar(j,'pendiente',new Error('Corte del dia sin fotografia valida; no consultar ventas tardias'));
    try {
      const s=await snapshotCopecFuel(j.fecha);
      await obligatorio(db().rpc('coseducam_guardar_snapshot',{p_id:j.id,p_lease:j.token_lease,p_consumos:s.consumos,p_litros:s.litros,p_litros_guia:s.litrosGuia,p_precio:s.precio}));
      await evento(j.fecha,'snapshot_listo',`${s.consumos.length} operaciones; ${s.litros} L; precio maximo STORAGE ${s.precio}`);
      return {accion:'snapshot_listo',fecha:j.fecha,litros:s.litros,litrosGuia:s.litrosGuia};
    }catch(e){return revisar(j,'pendiente',e);}
  }
  if(j.estado==='snapshot_listo') {
    if(!(Number(j.litros_guia)>0&&Number(j.precio_aplicado)>0))return revisar(j,'snapshot_listo',new Error('Snapshot sin litros o precio'));
    const existentes=await obligatorio(db().from('coseducam_guias').select('id').eq('fecha',j.fecha).eq('codigo_eds',EDS).limit(1));
    if(existentes.length)return revisar(j,'snapshot_listo',new Error('Ya existe reserva de guia para la fecha; no reemitir'));
    // MARCA DURABLE PREVIA AL ENVIO EXTERNO: nunca reintentar el POST mutador.
    await actualizarJob(j,'snapshot_listo',{estado:'emitiendo',token_lease:null,lease_hasta:null,ultimo_error:'Emision en curso o por verificar'});
    try{
      await obligatorio(db().from('coseducam_guias').insert({fecha:j.fecha,codigo_eds:EDS,litros:j.litros_guia,estado:'emitiendo'}));
    }catch(e){return revisar(j,'emitiendo',e,false);}
    let resp;
    try{resp=await emitirGuiaTAE({fecha:j.fecha,litrosGuia:Number(j.litros_guia),precio:Number(j.precio_aplicado)});}
    catch(e){await obligatorio(db().from('coseducam_guias').update({estado:'revision_requerida'}).eq('fecha',j.fecha).eq('codigo_eds',EDS).eq('estado','emitiendo').select('id'));return revisar(j,'emitiendo',new Error(`TAE requiere verificacion externa: ${errorTexto(e)}`),false);}
    // Si falla la persistencia despues de emision, nunca se repite.
    const reservadas=await obligatorio(db().from('coseducam_guias').update({estado:'creada',numero_guia:resp.numeroGuia,codigo_autorizacion:resp.codigoAutorizacion}).eq('fecha',j.fecha).eq('codigo_eds',EDS).eq('estado','emitiendo').select('id'));
    if(reservadas.length!==1)throw new Error('TAE emitio, pero no se pudo registrar: revision humana');
    await actualizarJob(j,'emitiendo',{estado:'esperando_enruta',numero_guia:resp.numeroGuia,codigo_autorizacion:resp.codigoAutorizacion,proximo_intento:ahora(1),ultimo_error:null},false);
    await evento(j.fecha,'guia_creada',`Guia ${resp.numeroGuia} autorizada; esperando En Ruta`);
    return {accion:'guia_creada',fecha:j.fecha,numeroGuia:resp.numeroGuia};
  }
  if(j.estado==='esperando_enruta') {
    const g=await obligatorio(db().from('coseducam_guias').select('*').eq('fecha',j.fecha).eq('codigo_eds',EDS).single());
    if(g.estado!=='creada'||!g.numero_guia||!g.codigo_autorizacion||g.numero_guia!==j.numero_guia)return revisar(j,'esperando_enruta',new Error('Guia En Ruta no consistente'));
    let pre;
    try{pre=await prevalidarEnRuta(g);}catch(e){
      if(e instanceof EsperarEnRuta) {
        const intentos=Number(j.intentos_enruta)+1;
        if(intentos>=10)return revisar(j,'esperando_enruta',new Error('En Ruta no encontro la guia tras 10 consultas'));
        await actualizarJob(j,'esperando_enruta',{intentos_enruta:intentos,proximo_intento:ahora(1),token_lease:null,lease_hasta:null,ultimo_error:errorTexto(e)});
        return {accion:'esperando_enruta',intentos,fecha:j.fecha};
      }
      return revisar(j,'esperando_enruta',e);
    }
    // NUNCA volver a confirmar automaticamente si la respuesta se pierde.
    await actualizarJob(j,'esperando_enruta',{estado:'confirmando',token_lease:null,lease_hasta:null,ultimo_error:'Confirmacion en curso o por verificar'});
    await cambiarGuia(g.id,'creada',{estado:'confirmando'});
    let r;
    try{r=await confirmarEnRuta(g,pre);}catch(e){await evento(j.fecha,'confirmacion_incierta',errorTexto(e));return revisar(j,'confirmando',e,false);}
    const f=new Date().toISOString();
    await cambiarGuia(g.id,'confirmando',{estado:'confirmada',confirmada_en:f});
    await actualizarJob(j,'confirmando',{estado:'confirmada',token_lease:null,lease_hasta:null,ultimo_error:null},false);
    await evento(j.fecha,'confirmada',`Guia ${g.numero_guia}, pedido ${r.numeroPedido}`);
    return {accion:'confirmada',fecha:j.fecha,numeroGuia:g.numero_guia};
  }
  throw new Error('Estado de job no permitido');
}
