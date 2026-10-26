import {timingSafeEqual} from 'node:crypto';
import {db,obligatorio} from '../lib/db.js';
const seguro=(a,b)=>{const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length>0&&x.length===y.length&&timingSafeEqual(x,y);};
export default async function handler(req,res){
  res.setHeader('Cache-Control','private, no-store');
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Usar GET'});
  if(!process.env.STATUS_SECRET||!seguro(req.headers['x-status-secret'],process.env.STATUS_SECRET))return res.status(401).json({ok:false,error:'No autorizado'});
  try{
    const jobs=await obligatorio(db().from('coseducam_jobs').select('fecha,codigo_eds,estado,litros_calculados,litros_guia,precio_aplicado,numero_guia,intentos_enruta,ultimo_error,actualizado_en').order('fecha',{ascending:false}).limit(30));
    const eventos=await obligatorio(db().from('coseducam_eventos').select('fecha,etapa,mensaje,creado_en').order('creado_en',{ascending:false}).limit(30));
    return res.status(200).json({ok:true,modo:process.env.OPERATIONS_ENABLED==='true'?'configurado_para_operar':'solo_lectura',jobs,eventos});
  }catch(e){return res.status(503).json({ok:false,error:'Supabase no disponible'});}
}
