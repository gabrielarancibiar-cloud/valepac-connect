-- Antes: SQL Editor -> guardar en Vault 'coseducam_project_url' y 'coseducam_secret_key'
-- select vault.create_secret('https://TU-PROYECTO.supabase.co', 'coseducam_project_url');
-- select vault.create_secret('sb_secret_...', 'coseducam_secret_key');
-- No ejecutar hasta desplegar funcion y configurar secreta en Vercel.
select cron.schedule('coseducam-cada-minuto', '* * * * *', $$
 select net.http_post(
  url:=(select decrypted_secret from vault.decrypted_secrets where name='coseducam_project_url') || '/functions/v1/coseducam-tick',
  headers:=jsonb_build_object('Content-Type','application/json','apikey',(select decrypted_secret from vault.decrypted_secrets where name='coseducam_secret_key')),
  body:='{}'::jsonb, timeout_milliseconds:=15000
 );
$$);
