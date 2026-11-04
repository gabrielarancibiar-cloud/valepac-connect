import test from 'node:test';
import assert from 'node:assert/strict';
import { conciliarCoseducam, parsearExcelEnRutaTsv, redondearLitros } from '../server/coseducam/seguimientoSoloLectura.js';
const hora='2026-11-02T18:23:01';
const base={fecha:'2026-11-02',codigo_eds:'40098',transaccion_id:'25',transaccion_codigo:'tx25',producto:'DIESEL',
  litros:5117.87,precio_unitario:1589,fecha_cierre_copec:hora,fecha_cierre_copec_raw:Date.parse(`${hora}Z`)/1000};
const guia={ 'RUT CLIENTE':'96.963.630-1',DESTINATARIO:'COSEDUCAM S.A.',PRODUCTO:'DIESEL',ESTADO:'CONFIRMADA',
  'FECHA AUTORIZACION':'02-11-2026','FECHA ESTADO':'03-11-2026','LITROS ENTREGADOS':'5.118,00',GUIA:'47257503','NUMERO PEDIDO':'10025'};
const consultar=(r={})=>conciliarCoseducam({periodo:'2026-11',consumos:[base],filasEnRuta:[guia],ahora:new Date('2026-11-04T20:00:00Z'),...r});
test('redondea 0,5 hacia arriba y 0,499 abajo',()=>{
  assert.equal(redondearLitros(5117.499),5117);assert.equal(redondearLitros(5117.5),5118);
});
test('retirado confirmado del dia original aunque FECHA ESTADO sea siguiente dia',()=>{
  const x=consultar();assert.equal(x.dias[0].estado,'RETIRO_TAE_OK');assert.equal(x.dias[0].consumo.precioTae,1589);
  assert.equal(x.resumen.retirosOk,1);assert.equal(x.dias[0].consumo.litrosEsperados,5118);
});
test('no confirma una guia solo creada',()=>{
  assert.equal(consultar({filasEnRuta:[{...guia,ESTADO:'PENDIENTE'}]}).dias[0].estado,'GUIA_EMITIDA_NO_CONFIRMADA');
});
test('detecta diferencias incluso cuando la guía está solo emitida',()=>{
  assert.equal(consultar({filasEnRuta:[{...guia,ESTADO:'PENDIENTE','LITROS ENTREGADOS':'5119'}]}).dias[0].estado,'DIFERENCIA_LITROS');
});
test('no confirma con diferencia de litros',()=>{
  assert.equal(consultar({filasEnRuta:[{...guia,'LITROS ENTREGADOS':'5119'}]}).dias[0].estado,'DIFERENCIA_LITROS');
});
test('no confirma guía de otro cliente',()=>{
  assert.equal(consultar({filasEnRuta:[{...guia,'RUT CLIENTE':'11.111.111-1',DESTINATARIO:'OTRA EMPRESA'}]}).dias[0].estado,'SIN_GUIA_ENRUTA');
});
test('no confirma guía de otra fecha',()=>{
  assert.equal(consultar({filasEnRuta:[{...guia,'FECHA AUTORIZACION':'03-11-2026'}]}).dias[0].estado,'SIN_GUIA_ENRUTA');
});
test('no confunde fecha estado con fecha de autorizacion',()=>{
  const {'FECHA AUTORIZACION':f,...sinOrigen}=guia;
  assert.equal(consultar({filasEnRuta:[sinOrigen]}).dias[0].estado,'ENRUTA_DATOS_INSUFICIENTES');
});
test('no acredita retirada sin numero de guia',()=>{
  const {GUIA:n,...sinNumero}=guia;
  assert.equal(consultar({filasEnRuta:[sinNumero]}).dias[0].estado,'ENRUTA_DATOS_INSUFICIENTES');
});
test('no acredita si en ruta no responde',()=>{
  assert.equal(consultar({enRutaDisponible:false}).dias[0].estado,'ENRUTA_NO_DISPONIBLE');
});
test('detecta dos guías confirmadas para un día',()=>{
  assert.equal(consultar({filasEnRuta:[guia,{...guia,GUIA:'47257504'}]}).dias[0].estado,'REVISION_MULTIPLES_GUIAS');
});
test('no acredita producto distinto a diesel',()=>{
  assert.equal(consultar({filasEnRuta:[{...guia,PRODUCTO:'GASOLINA 93'}]}).dias[0].estado,'SIN_GUIA_ENRUTA');
});
test('parsea el reporte TSV sin inventar encabezados',()=>{
  const x=parsearExcelEnRutaTsv('ESTADO\tGUIA\tLITROS ENTREGADOS\nCONFIRMADA\t4725\t5.118,00\n');
  assert.deepEqual(x.columnas,['ESTADO','GUIA','LITROS ENTREGADOS']);assert.equal(x.filas[0].GUIA,'4725');
});
test('no equipara CERRADO o ENTREGADO a confirmación TAE sin acreditar',()=>{
  assert.equal(consultar({filasEnRuta:[{...guia,ESTADO:'CERRADO'}]}).dias[0].estado,'ENRUTA_ESTADO_NO_ACREDITADO');
  assert.equal(consultar({filasEnRuta:[{...guia,ESTADO:'ENTREGADO'}]}).dias[0].estado,'ENRUTA_ESTADO_NO_ACREDITADO');
});
test('varias guías finales en un día provocan revisión incluso con litros distintos',()=>{
  assert.equal(consultar({filasEnRuta:[guia,{...guia,GUIA:'47257504','LITROS ENTREGADOS':'5000'}]}).dias[0].estado,'REVISION_MULTIPLES_GUIAS');
});
test('consulta read-only devuelve solo fuentes autorizadas',()=>{
  const x=consultar();assert.equal(x.soloLectura,true);
  assert.ok(!('jobs' in x));assert.ok(!('preparaciones' in x));
});
