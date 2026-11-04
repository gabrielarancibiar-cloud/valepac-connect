import test from 'node:test';
import assert from 'node:assert/strict';
import { consultarSeguimientoCoseducam } from '../server/coseducam/seguimientoRead.js';

const fecha = '2026-10-20';
const fechaCierre = `${fecha}T15:30:00`;
const consumo = {
  fecha,codigo_eds:'40098',transaccion_id:'123',transaccion_codigo:'ABC123',
  producto:'DIESEL',litros:2250.5,patente:'XXYY99',precio_unitario:1589,
  fecha_cierre_copec:fechaCierre,fecha_cierre_copec_raw:Date.parse(`${fechaCierre}Z`)/1000,
};
function crearMockDb() {
  const llamadas=[];
  const consulta={
    select(){return this;},gte(){return this;},lte(){return this;},eq(){return this;},
    order(){return this;},
    range(a,b) {llamadas.push({a,b});return Promise.resolve({data:[consumo],error:null});},
  };
  return {db:{from(name){assert.equal(name,'coseducam_consumos');return consulta;}},llamadas};
}
const reporte=`ESTADO\tPRODUCTO\tLITROS ENTREGADOS\tGUIA\tFECHA AUTORIZACION\tRUT CLIENTE\tDESTINATARIO\tNUMERO PEDIDO\nCONFIRMADA\tDIESEL\t2.251,00\t47259999\t20-10-2026\t96.963.630-1\tCOSEDUCAM S.A.\t10025\n`;
test('el seguimiento solo consulta las dos fuentes y retorna retiro OK con coincidencia estricta',async()=>{
  const {db,llamadas}=crearMockDb();
  const invocaciones=[];
  const resultado=await consultarSeguimientoCoseducam({
    periodo:'2026-10',supabaseAdmin:db,
    obtenerExcelEnRuta:async(v)=>{invocaciones.push(v);return {bytes:new TextEncoder().encode(reporte)};},
  });
  const dia=resultado.dias.find(x=>x.fecha===fecha);
  assert.equal(dia.estado,'RETIRO_TAE_OK');
  assert.equal(dia.consumo.litrosEsperados,2251);
  assert.equal(dia.consumo.precioTae,1589);
  assert.equal(dia.guia.numeroGuia,'47259999');
  assert.equal(llamadas.length,1);
  assert.equal(invocaciones[0].codigoEds,'40098');
  assert.equal(resultado.soloLectura,true);
});
test('fallo En Ruta no deja acreditados retiros y conserva litros CopecFuel',async()=>{
  const {db}=crearMockDb();
  const old=console.warn;
  console.warn=()=>{};
  try {
    const resultado=await consultarSeguimientoCoseducam({periodo:'2026-10',supabaseAdmin:db,
      obtenerExcelEnRuta:async()=>{throw new Error('En Ruta sin datos');}});
    assert.equal(resultado.dias.find(x=>x.fecha===fecha).estado,'ENRUTA_NO_DISPONIBLE');
    assert.equal(resultado.resumen.litros,2250.5);
    assert.equal(resultado.resumen.retirosOk,0);
  } finally {console.warn=old;}
});
