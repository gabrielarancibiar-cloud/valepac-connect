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
test('no declara diferencia mientras el pedido esté pendiente, aunque litros entregados sean cero',()=>{
  const dia=consultar({filasEnRuta:[{...guia,ESTADO:'PENDIENTE ENVÍO','LITROS ENTREGADOS':'0,00','LITROS SOLICITADOS':'5.118,00'}]}).dias[0];
  assert.equal(dia.estado,'GUIA_EMITIDA_NO_CONFIRMADA');
  assert.equal(dia.conciliacion.diferenciaLitros,null);
  assert.equal(dia.guia.litrosSolicitados,5118);
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
test('suma múltiples guías sin duplicarlas y detecta diferencias',()=>{
  const filas=[{...guia,'LITROS ENTREGADOS':'3.000,00'},
    {...guia,GUIA:'47257504','LITROS ENTREGADOS':'2.118,00'}];
  const dia=consultar({filasEnRuta:filas}).dias[0];
  assert.equal(dia.estado,'RETIRO_TAE_OK');
  assert.equal(dia.guias.length,2);
  assert.equal(dia.conciliacion.litrosEnRuta,5118);
});
test('no acredita producto distinto a diesel',()=>{
  assert.equal(consultar({filasEnRuta:[{...guia,PRODUCTO:'GASOLINA 93'}]}).dias[0].estado,'SIN_GUIA_ENRUTA');
});
test('parsea el reporte TSV sin inventar encabezados',()=>{
  const x=parsearExcelEnRutaTsv('ESTADO\tGUIA\tLITROS ENTREGADOS\nCONFIRMADA\t4725\t5.118,00\n');
  assert.deepEqual(x.columnas,['ESTADO','GUIA','LITROS ENTREGADOS']);assert.equal(x.filas[0].GUIA,'4725');
});
test('CERRADO y ENTREGADO son finales según la validación operacional',()=>{
  assert.equal(consultar({filasEnRuta:[{...guia,ESTADO:'CERRADO'}]}).dias[0].estado,'RETIRO_TAE_OK');
  assert.equal(consultar({filasEnRuta:[{...guia,ESTADO:'ENTREGADO'}]}).dias[0].estado,'RETIRO_TAE_OK');
});
test('varias guías finales que no suman el total esperado presentan diferencia',()=>{
  assert.equal(consultar({filasEnRuta:[guia,{...guia,GUIA:'47257504','LITROS ENTREGADOS':'5000'}]}).dias[0].estado,'DIFERENCIA_LITROS');
});
test('filas repetidas con mismo número no inflan el total del día',()=>{
  assert.equal(consultar({filasEnRuta:[guia,{...guia}]}).dias[0].estado,'REVISION_GUIA_REPETIDA');
});
test('consulta read-only devuelve solo fuentes autorizadas',()=>{
  const x=consultar();assert.equal(x.soloLectura,true);
  assert.ok(!('jobs' in x));assert.ok(!('preparaciones' in x));
});

test('reporte real: CERRADO, fecha creación y estado del día siguiente, DTE como número',()=>{
  const fila={
    RUT:'96.963.630-1',DESTINATARIO:'COSEDUCAM S.A.',ESTACION:'40098',
    PRODUCTO:'D',ESTADO:'CERRADO',
    'FECHA CREACION':'02-11-2026 23:53:18',
    'FECHA ESTADO':'03-11-2026 09:53:12',
    'LITROS ENTREGADOS':'5.118,00','LITROS SOLICITADOS':'5.118,00',
    DTE:'47267848','NUMERO PEDIDO':'2981661',
  };
  const dia=consultar({filasEnRuta:[fila]}).dias[0];
  assert.equal(dia.estado,'RETIRO_TAE_OK');
  assert.equal(dia.guia.numeroGuia,'47267848');
  assert.equal(dia.guia.estadoEnRuta,'CERRADO');
  assert.equal(dia.guia.fechaEstado,'03-11-2026 09:53:12');
  assert.equal(dia.conciliacion.diferenciaLitros,0.13);
  assert.equal(dia.conciliacion.diferenciaEnteros,0);
});
test('cliente equivocado no se acepta aunque el volumen coincida y use estado CERRADO',()=>{
  const ajeno={...guia,ESTADO:'CERRADO',RUT:'76.108.888-2',DESTINATARIO:'CONSTRUCTORA'};
  delete ajeno['RUT CLIENTE'];
  assert.equal(consultar({filasEnRuta:[ajeno]}).dias[0].estado,'SIN_GUIA_ENRUTA');
});
test('estado no reconocido no acredita retiro TAE',()=>{
  assert.equal(consultar({filasEnRuta:[{...guia,ESTADO:'EN REVISIÓN'}]}).dias[0].estado,'ENRUTA_ESTADO_NO_ACREDITADO');
});
test('no usa fecha estado como fecha creación y no acredita guia de otro dia',()=>{
  const mismoEstado={...guia,'FECHA CREACION':'03-11-2026','FECHA ESTADO':'02-11-2026 23:50:00'};
  assert.equal(consultar({filasEnRuta:[mismoEstado]}).dias[0].estado,'SIN_GUIA_ENRUTA');
});

test('caso real 04-11: 353,2 L -> 353 L, CERRADO con diferencia -0,2 L',()=>{
  const dia=conciliarCoseducam({periodo:'2026-11',consumos:[{
    ...base,fecha:'2026-11-04',litros:353.2,fecha_cierre_copec:'2026-11-04T20:01:00',
    fecha_cierre_copec_raw:Date.parse('2026-11-04T20:01:00Z')/1000,
  }],filasEnRuta:[{
    RUT:'96.963.630-1',DESTINATARIO:'COSEDUCAM S.A.',ESTACION:'40098',PRODUCTO:'D',
    ESTADO:'CERRADO','FECHA CREACION':'04-11-2026 23:53:00',
    'FECHA ESTADO':'04-11-2026 23:53:58',
    DTE:'47268116','LITROS ENTREGADOS':'353,00',
  }],ahora:new Date('2026-11-05T15:00:00Z')}).dias[0];
  assert.equal(dia.estado,'RETIRO_TAE_OK');
  assert.equal(dia.guia.numeroGuia,'47268116');
  assert.equal(dia.conciliacion.diferenciaLitros,-0.2);
  assert.equal(dia.conciliacion.litrosCoinciden,true);
});
test('pedido COSEDUCAM PENDIENTE ENVÍO sin DTE se muestra pendiente, no como fallo de litros',()=>{
  const fila={...guia,ESTADO:'PENDIENTE ENVÍO',
    'LITROS ENTREGADOS':'0,00','LITROS SOLICITADOS':'5.118,00'};
  delete fila.GUIA;
  const dia=consultar({filasEnRuta:[fila]}).dias[0];
  assert.equal(dia.estado,'GUIA_EMITIDA_NO_CONFIRMADA');
  assert.equal(dia.conciliacion.diferenciaLitros,null);
  assert.equal(dia.guia.numeroPedido,'10025');
});
