import {createClient} from '@supabase/supabase-js';
let cliente;
export function db() {
  if(cliente)return cliente;
  const url=process.env.SUPABASE_URL;
  const key=process.env.SUPABASE_SECRET_KEY;
  if(!url||!key||!url.startsWith('https://'))throw new Error('Faltan credenciales nuevas de Supabase');
  cliente=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  return cliente;
}
export async function obligatorio(promise) {
  const r=await promise;
  if(r.error)throw new Error(`Supabase: ${r.error.message}`);
  return r.data;
}
