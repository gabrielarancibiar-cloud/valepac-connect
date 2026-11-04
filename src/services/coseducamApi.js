import { apiFetch } from '../lib/api.js';
// COSEDUCAM en VALEPAC Connect es SOLO LECTURA.
export async function obtenerCoseducam(periodo) {
  const params=new URLSearchParams({periodo});
  const respuesta=await apiFetch(`/api/conciliacion/muevo-empresa?tipo=coseducam&recurso=seguimiento_coseducam&${params}`,{
    method:'GET',headers:{Accept:'application/json'},cache:'no-store',
  });
  const datos=await respuesta.json().catch(()=>null);
  if(!respuesta.ok || datos?.ok!==true) throw new Error(datos?.error||`Consulta falló (HTTP ${respuesta.status}).`);
  return datos;
}
