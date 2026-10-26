import test from 'node:test';
import assert from 'node:assert/strict';
import {redondearLitros,elaborarSnapshot,fechaHoraVenta,horaChile,esCoseducamDiesel} from '../lib/logic.js';
const fecha='2026-10-22';
const fila = (id,hora,forma='STORAGE') => ({fecha,hora,codigoEds:'40098',transaccionTipo:'venta',operacionTipo:'asistido',formaPagoNombre:forma,productoDescripcion:'Diesel',clienteRutRut:'96.963.630-1',transaccionId:id,cantidad:10.5,precio:1050,total:11025});

test('redondeo 0.5 sube y 0.499 baja',()=>{assert.equal(redondearLitros(10.5),11);assert.equal(redondearLitros(10.499),10);});
test('corte estricto 23:50:00 y precio maximo de cargas incluidas',()=>{
  const s=elaborarSnapshot([fila('a','23:49:59'),{...fila('b','23:50:00'),precio:9999},{...fila('c','20:00:00','EFECTIVO'),precio:5000}],fecha);
  assert.equal(s.litros,10.5);assert.equal(s.litrosGuia,11);assert.equal(s.precio,1050);assert.equal(s.consumos.length,1);
});
test('no inventa hora',()=>assert.throws(()=>fechaHoraVenta({fecha}),/hora verificables/));
test('repetidos bloquean',()=>assert.throws(()=>elaborarSnapshot([fila('a','23:40:00'),fila('a','23:41:00')],fecha),/repetida/));
test('Chile tiene huso horario explicito para programacion',()=>assert.equal(horaChile(new Date('2026-10-23T02:50:00Z')).fecha,'2026-10-22'));
test('CopecFuel timestamp civil crudo no se reconvierte a Chile',()=>{
  const r={...fila('x','09:00:00'),fecha:'2026-10-14',transaccionFechaCierre:1791946474,turnoId:20261014};
  assert.deepEqual(fechaHoraVenta(r),{fecha:'2026-10-14',hora:'02:54:34'});
});
test('CopecFuel no acepta diferencia entre turno y fecha de venta',()=>assert.throws(()=>fechaHoraVenta({fecha:'2026-10-13',transaccionFechaCierre:1791946474}),/no coincide/));
test('productoDescripcion Diesel y RUT COSEDUCAM reconocidos',()=>assert.equal(esCoseducamDiesel(fila('x','12:00:00')),true));
test('no confundir RUT cliente con concesionario',()=>assert.equal(esCoseducamDiesel({...fila('x','12:00:00'),clienteRutRut:'78229820-8'}),false));
test('precio máximo de TODAS las guías STORAGE y litros totales',()=>{
  const s=elaborarSnapshot([
    {...fila('a','10:00:00'),precio:1490,cantidad:300},
    {...fila('b','11:00:00'),precio:1497,cantidad:250},
    {...fila('c','12:00:00'),precio:1495,cantidad:400},
    {...fila('otro','12:30:00','EFECTIVO'),precio:1999},
  ],fecha);
  assert.equal(s.litros,950);assert.equal(s.litrosGuia,950);assert.equal(s.precio,1497);
  assert.equal(s.precio*s.litrosGuia,1422150);
  assert.deepEqual(s.consumos.map(x=>x.precio_unitario),[1490,1497,1495]);
});
test('precio más alto de un consumo minoritario manda sobre la moda',()=>{
  const s=elaborarSnapshot([
    {...fila('a','10:00:00'),precio:1490},
    {...fila('b','11:00:00'),precio:1490},
    {...fila('c','12:00:00'),precio:1500},
  ],fecha);
  assert.equal(s.precio,1500);
});
test('precio de ventas asistidas que no son STORAGE jamás interviene',()=>{
  const s=elaborarSnapshot([fila('a','12:00:00'),{...fila('b','12:05:00','EFECTIVO'),precio:9999}],fecha);
  assert.equal(s.precio,1050);
});
test('bloquea precio faltante en UNA venta STORAGE aunque otra sea válida',()=>{
  assert.throws(()=>elaborarSnapshot([fila('a','10:00:00'),{...fila('b','11:00:00'),precio:null}],fecha),/precio unitario/);
});
test('bloquea precio negativo, cero o fraccionario sin redondearlo',()=>{
  for(const valor of [0,-1,1497.5,'no definido'])
    assert.throws(()=>elaborarSnapshot([{...fila('a','11:00:00'),precio:valor}],fecha),/precio unitario/);
});
test('no incorpora ni usa precios de transacciones desde las 23:50',()=>{
  const s=elaborarSnapshot([fila('a','23:49:59'),{...fila('b','23:59:59'),precio:15000}],fecha);
  assert.equal(s.precio,1050);assert.equal(s.consumos.length,1);
});
test('bloquea precisión de litros no representable en esquema numeric(14,3)',()=>{
  assert.throws(()=>elaborarSnapshot([{...fila('a','12:00:00'),cantidad:100.2345}],fecha),/precision superior/);
});

test('filas desde 23:50 se descartan incluso si no traen EDS',()=>{
  const s=elaborarSnapshot([fila('a','23:49:59'),{...fila('b','23:50:00'),codigoEds:undefined}],fecha);
  assert.equal(s.consumos.length,1);
});
