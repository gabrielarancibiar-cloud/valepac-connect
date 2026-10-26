import {timingSafeEqual} from 'node:crypto';
import {EDS,elaborarSnapshot,horaChile} from '../../lib/logic.js';
import {consultarCopecFuel,diagnosticarEds} from '../../lib/copecfuel.js';

function seguro(a,b){const aa=Buffer.from(String(a||''));const bb=Buffer.from(String(b||''));return aa.length>0&&aa.length===bb.length&&timingSafeEqual(aa,bb);}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET') return res.status(405).json({ok:false,error:'Solo GET'});
  if(!process.env.STATUS_SECRET||!seguro(req.headers['x-status-secret'],process.env.STATUS_SECRET)) return res.status(401).json({ok:false,error:'No autorizado'});
  const chile=horaChile();
  // SOLO fecha operacional actual; no reabrir dias historicos ni tocar guias.
  const fecha=String(req.query.fecha||chile.fecha);
  if(fecha!==chile.fecha) return res.status(400).json({ok:false,error:'Solo lectura del dia operacional actual'});
  try{
    const {filas,origen}=await consultarCopecFuel(fecha);
    let s;
    try{s=elaborarSnapshot(filas,fecha,EDS);}
    catch(e){
      if(e instanceof Error && e.message==='CopecFuel: fila sin EDS 40098 acreditada'){
        return res.status(422).json({ok:false,soloLectura:true,fecha,
          error:'Existe al menos una fila previa al corte cuya EDS no se pudo acreditar como 40098. Ninguna fila se ha guardado.',
          diagnosticoEds:diagnosticarEds(filas,fecha),
          diagnosticoOrigen:origen,
          siguientePaso:'Confirmar con Copec la relacion exclusiva entre COPEC_CLIENTE_ID y EDS 40098. El prefijo o clienteId por si solos no autorizan asignar EDS.'});
      }
      throw e;
    }
    return res.status(200).json({ok:true,soloLectura:true,fecha,estado:'preliminar',
      fuente:'API_OFICIAL_COPECFUEL',corte:'23:50:00',horaConsultaChile:chile.hora,
      totalVentasRevisadas:s.totalFuente,transaccionesCoseducam:s.consumos.length,
      litros:s.litros,litrosGuiaCalculados:s.litrosGuia,precioMaximoStorage:s.precio,
      advertencia:'Diagnostico no acredita que CopecFuel ya haya completado el cierre del dia. No crea trabajos, guias ni registros.'});
  }catch(e){
    // No filtrar datos individuales, respuestas proveedor ni credenciales.
    const msg=e instanceof Error?e.message:'Error no identificado';
    console.error('CopecFuel diagnostico:',msg);
    return res.status(503).json({ok:false,soloLectura:true,fecha,error:msg});
  }
}
