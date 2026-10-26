import {timingSafeEqual} from 'node:crypto';
import {ejecutar} from '../lib/worker.js';
function seguro(a,b){const aa=Buffer.from(String(a||''));const bb=Buffer.from(String(b||''));return aa.length>0&&aa.length===bb.length&&timingSafeEqual(aa,bb);}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Usar POST'});
  if(!process.env.WORKER_SECRET||!seguro(req.headers['x-worker-secret'],process.env.WORKER_SECRET))return res.status(401).json({ok:false,error:'No autorizado'});
  try{return res.status(200).json({ok:true,...await ejecutar()});}
  catch(e){console.error('Worker:',e instanceof Error?e.message:'Error');return res.status(503).json({ok:false,error:'Ejecucion detenida; consultar eventos y estado de trabajo'});}
}
