import test from 'node:test';
import assert from 'node:assert/strict';
import { transformarConsumosEnVivo } from '../server/coseducam/consumosEnVivo.js';
import { consultarSeguimientoCoseducam } from '../server/coseducam/seguimientoRead.js';

const fecha = '2026-11-05';
const marca = (hora) => Math.trunc(Date.parse(`${fecha}T${hora}Z`) / 1000);
function venta(id, cantidad, precio, extra={}) {
  return {
    fecha, turnoId:'20261105',codigoEds:'40098',
    transaccionId:id,transaccionCodigo:`T-${id}`,
    clienteRutRut:'96.963.630-1', clienteRutRazonSocial:'COSEDUCAM S.A.',
    formaPagoNombre:'STORAGE',productoDescripcion:'DIESEL',cantidad,precio,total:cantidad*precio,
    transaccionFechaCierre:marca('12:10:00'),...extra,
  };
}
const reporte={codigoEds:'40098',filasCombustible:[
  venta('a',200.2,1589),
  venta('b',153,1599),
  venta('c',700,2300,{clienteRutRut:'11.111.111-1',clienteRutRazonSocial:'OTRO CLIENTE'}),
  venta('d',900,1700,{formaPagoNombre:'EFECTIVO'}),
  venta('e',1000,1700,{total:0}),
]};
const db={from(nombre){assert.equal(nombre,'coseducam_consumos');return {
  select(){return this;},gte(){return this;},lte(){return this;},eq(){return this;},
  order(){return this;},range(){return Promise.resolve({data:[],error:null});},
};}};
const csv = 'ESTADO\tPRODUCTO\tLITROS ENTREGADOS\tGUIA TAE\tFECHA CREACION\tRUT\tDESTINATARIO\tNUMERO PEDIDO\n';
const leerExcel=async()=>({bytes:new TextEncoder().encode(csv)});

test('construye parcial exclusivo STORAGE COSEDUCAM y respeta precio máximo de cargas válidas',()=>{
  const filas=transformarConsumosEnVivo(fecha,reporte);
  assert.equal(filas.length,2);
  assert.deepEqual(filas.map(x=>x.precio_unitario),[1589,1599]);
  assert.equal(filas[0].fecha_cierre_copec,'2026-11-05 12:10:00');
});
test('omite duplicados idénticos y rechaza discrepancias de estación/turno',()=>{
  const repetido={codigoEds:'40098',filasCombustible:[venta('a',200.2,1589),venta('a',200.2,1589)]};
  assert.equal(transformarConsumosEnVivo(fecha,repetido).length,1);
  assert.throws(()=>transformarConsumosEnVivo(fecha,{...reporte,codigoEds:'99999'}),/EDS distinta/);
  assert.throws(()=>transformarConsumosEnVivo(fecha,{codigoEds:'40098',filasCombustible:[venta('a',1,1000,{turnoId:'20261104'})]}),/Turno CopecFuel distinto/);
});
test('el botón consulta API en vivo para hoy sin escribir SQL, informa acumulado parcial y mantiene retiro pendiente',async()=>{
  let invocaciones=0;
  const resultado=await consultarSeguimientoCoseducam({
    periodo:'2026-11',supabaseAdmin:db,obtenerExcelEnRuta:leerExcel,
    obtenerVentasEnVivo:async(f,op)=>{invocaciones++;assert.equal(f,fecha);assert.equal(op.soloCombustible,true);return reporte;},
    ahora:new Date('2026-11-05T18:20:00Z'),
  });
  const dia=resultado.dias.find(x=>x.fecha===fecha);
  assert.equal(invocaciones,1);
  assert.equal(dia.consumo.litros,353.2);
  assert.equal(dia.consumo.precioTae,1599);
  assert.equal(dia.consumo.cargas,2);
  assert.equal(dia.consumo.litrosEsperados,353);
  assert.equal(dia.estado,'CONSUMO_PARCIAL');
  assert.equal(dia.categoria,'pendiente');
  assert.equal(dia.parcial,true);
  assert.equal(resultado.soloLectura,true);
  assert.equal(resultado.actualizacionDelDia.estado,'PARCIAL');
});
test('al pasar el corte no consulta API en vivo ni reemplaza filas históricas',async()=>{
  const resultado=await consultarSeguimientoCoseducam({
    periodo:'2026-11',supabaseAdmin:db,obtenerExcelEnRuta:leerExcel,
    obtenerVentasEnVivo:async()=>{throw new Error('No debe consultar');},
    ahora:new Date('2026-11-06T02:51:00Z'),
  });
  assert.equal(resultado.actualizacionDelDia,null);
  assert.equal(resultado.advertenciaCopecFuel,null);
});
test('si CopecFuel falla, no presenta un 0 como vista en vivo acreditada',async()=>{
  const warn=console.warn;console.warn=()=>{};
  try {
    const resultado=await consultarSeguimientoCoseducam({
      periodo:'2026-11',supabaseAdmin:db,obtenerExcelEnRuta:leerExcel,
      obtenerVentasEnVivo:async()=>{throw new Error('API indisponible');},
      ahora:new Date('2026-11-05T18:20:00Z'),
    });
    assert.equal(resultado.actualizacionDelDia,null);
    assert.ok(resultado.advertenciaCopecFuel);
    assert.equal(resultado.dias.some(x=>x.fecha===fecha),false);
  } finally {console.warn=warn;}
});
test('carga después de las 23:50 no se incluye en el acumulado elegible',async()=>{
  const postCorte={codigoEds:'40098',filasCombustible:[
    venta('a',200.2,1589),venta('b',1000,2000,{transaccionFechaCierre:marca('23:51:00')}),
  ]};
  const resultado=await consultarSeguimientoCoseducam({
    periodo:'2026-11',supabaseAdmin:db,obtenerExcelEnRuta:leerExcel,
    obtenerVentasEnVivo:async()=>postCorte,
    ahora:new Date('2026-11-05T18:20:00Z'),
  });
  const dia=resultado.dias.find(x=>x.fecha===fecha);
  assert.equal(dia.consumo.litros,200.2);
  assert.equal(dia.consumo.precioTae,1589);
});
