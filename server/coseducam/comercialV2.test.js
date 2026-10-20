import test from 'node:test';
import assert from 'node:assert/strict';
import {clasificarConsumosV2, debeBloquearEmisionV2} from './comercialV2.js';
const base=(fecha,hora,litros,precio,numero)=>({
  fecha, codigo_eds:'40098', transaccion_id:`id-${numero}`,
  transaccion_codigo:`40098-${numero}`, producto:'DIESEL', litros,
  precio_unitario:precio,fecha_cierre_copec:`${fecha} ${hora}`,
  fecha_cierre_copec_raw:Math.floor(Date.parse(`${fecha}T${hora}Z`) / 1000),
});
test('histórico 14/10 consultable y precio STORAGE correcto',()=>{
 const x=clasificarConsumosV2('2026-10-14',[base('2026-10-14','01:09:14',300,1497,1),base('2026-10-14','06:07:30',307.55,1497,2)]);
 assert.equal(x.historico,true); assert.equal(x.litros,607.55);assert.equal(x.precioTae,1497);
});
test('corte 23:50 exacto, exclusión sin regularización',()=>{
 const x=clasificarConsumosV2('2026-10-20',[base('2026-10-20','00:00:00',300,1497,1),base('2026-10-20','23:49:59',50.125,1499,2),base('2026-10-20','23:50:00',75,1510,3),base('2026-10-20','23:59:59',100,1550,4)]);
 assert.equal(x.registros,2);assert.equal(x.registrosExcluidos,2);assert.equal(x.litros,350.125);assert.equal(x.litrosExcluidos,175);assert.equal(x.precioTae,1499);assert.equal(x.completo,true);
});
test('cualquier precio faltante bloquea el máximo del lote',()=>{
 const x=clasificarConsumosV2('2026-10-20',[base('2026-10-20','06:00:00',200,null,1),base('2026-10-20','06:03:00',300,1497,2)]);
 assert.equal(x.precioTae,null);assert.equal(x.invalidos.length,1);assert.equal(x.completo,false);
});
test('datos sin hora oficial nunca se tratan como elegibles',()=>{
 const a=base('2026-10-20','06:00:00',300,1497,1);a.fecha_cierre_copec=null;
 const x=clasificarConsumosV2('2026-10-20',[a]);
 assert.equal(x.registros,0);assert.equal(x.invalidos.length,1);assert.equal(x.completo,false);
});
test('timestamp incoherente bloquea precio y emisión',()=>{
 const f=base('2026-10-20','06:00:00',300,1497,7);
 f.fecha_cierre_copec_raw-=3600;
 const x=clasificarConsumosV2('2026-10-20',[f]);
 assert.equal(x.invalidos.length,1); assert.equal(x.completo,false); assert.equal(x.precioTae,null);
});
test('transacciones duplicadas bloquean el lote',()=>{
 const a=base('2026-10-20','05:00:00',300,1497,1);
 const x=clasificarConsumosV2('2026-10-20',[a,{...a,litros:400}]);
 assert.equal(x.duplicados,true);assert.equal(x.precioTae,null);
});
test('corte y flags bloquean historicidad y ejecución prematura',()=>{
 const v={fecha:'2026-10-20',hoyChile:'2026-10-20',ahoraChile:'2026-10-20T23:50:00',flag:true};
 assert.equal(debeBloquearEmisionV2(v),false);
 assert.equal(debeBloquearEmisionV2({...v,flag:false}),true);
 assert.equal(debeBloquearEmisionV2({...v,fecha:'2026-10-13'}),true);
 assert.equal(debeBloquearEmisionV2({...v,ahoraChile:'2026-10-20T23:49:59'}),true);
});
