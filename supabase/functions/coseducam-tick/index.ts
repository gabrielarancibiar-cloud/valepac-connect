// Cron Supabase -> Vercel. El scheduler no tiene permisos para emitir guias.
import { withSupabase } from 'npm:@supabase/server@1';
export default {
  fetch: withSupabase({ auth: 'secret' }, async (_req: Request) => {
    const url = Deno.env.get('VERCEL_WORKER_URL');
    const clave = Deno.env.get('VERCEL_WORKER_SECRET');
    if (!url || !clave || !/^https:\/\//.test(url)) return Response.json({ok:false,error:'Configuracion de conexion Vercel incompleta'}, {status:503});
    try {
      const resp = await fetch(url, {method:'POST',headers:{'x-worker-secret':clave,'Content-Type':'application/json'}, body:'{}',signal:AbortSignal.timeout(45000)});
      const data = await resp.text();
      return new Response(data,{status:resp.status,headers:{'Content-Type':'application/json'}});
    } catch (e) {console.error('Conector Vercel no disponible',e instanceof Error?e.message:'error');return Response.json({ok:false,error:'Vercel no disponible'}, {status:503});}
  })
};
