// Endpoint privado, solo llamadas del COSEDUCAM worker autenticadas.
import { supabaseAdmin } from '../_lib/supabaseAdmin.js';
import { crearControlHandler } from '../../server/coseducam/workerControlCore.js';

export default crearControlHandler({
  rpc: (nombre, argumentos) => supabaseAdmin.rpc(nombre, argumentos),
  tabla: (nombre) => supabaseAdmin.from(nombre),
  secreto: () => process.env.COSEDUCAM_WORKER_SECRET || '',
});
