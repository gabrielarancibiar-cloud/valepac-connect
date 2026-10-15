// Añadir al repositorio de Vercel: api/daily/control.js
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { supabaseAdmin } from './supabaseAdmin.js';
const reply=(res,status,body)=>res.status(status).json(body);
const chile=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const isoMinus=(date,minus)=>{const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-minus);return d.toISOString().slice(0,10);};
const same=(a,b)=>{
  const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length && timingSafeEqual(x,y);
};
export default async function handler(req,res){
  if(req.method!=='POST')return reply(res,405,{ok:false,error:'POST only'});
  const expected=process.env.COSEDUCAM_WORKER_SECRET||'';
  const supplied=String(req.headers['x-valepac-worker-secret']||'');
  if(!expected || !same(supplied,expected))return reply(res,401,{ok:false,error:'Unauthorized'});
  const today=chile();
  const {action,runDate,id,token,ok,error}=req.body||{};
  if(runDate!==today)return reply(res,400,{ok:false,error:'Solo fecha de Chile actual'});
  try{
    if(action==='schedule'){
      const rows=[];
      for(let i=3;i>=0;i--){const date=isoMinus(today,i);rows.push({run_date:today,step_key:`copecfuel-${date}`,step_date:date,step_type:'copecfuel'});}
      rows.push({run_date:today,step_key:`portal-${isoMinus(today,3)}`,step_date:isoMinus(today,3),step_type:'portal'});
      // Upsert solo si no existe: jamás reinicia pasos ya completados ni en revisión.
      const {error:e}=await supabaseAdmin.from('daily_sync_steps').upsert(rows,{onConflict:'run_date,step_key',ignoreDuplicates:true});
      if(e)throw e;
      return reply(res,200,{ok:true,scheduled:rows.length});
    }
    if(action==='claim'){
      const claimToken=randomUUID();
      const {data,error:e}=await supabaseAdmin.rpc('daily_sync_claim',{p_today:today,p_token:claimToken});
      if(e)throw e;
      return reply(res,200,{ok:true,...data});
    }
    if(action==='finish'){
      if(!Number.isSafeInteger(id)||typeof token!=='string'||typeof ok!=='boolean')return reply(res,400,{ok:false,error:'Invalid finish arguments'});
      const {data,error:e}=await supabaseAdmin.rpc('daily_sync_finish',{p_id:id,p_token:token,p_ok:ok,p_error:String(error||'').slice(0,500)});
      if(e)throw e;
      return reply(res,200,data);
    }
    return reply(res,400,{ok:false,error:'Unknown action'});
  }catch(e){console.error('[daily-control]',e?.message);return reply(res,503,{ok:false,error:'Control no disponible; no ejecutar sincronizaciones'});}
}
