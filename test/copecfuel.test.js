import test from 'node:test';
import assert from 'node:assert/strict';
import {consultarCopecFuel,snapshotCopecFuel,extraerVentasCombustible,diagnosticarEds,diagnosticarOrigenReporte} from '../lib/copecfuel.js';
const env={COPEC_API_URL:'https://api2pr.copecfuel.com/INTEGR1/transacciones',COPEC_TOKEN:'TOKEN_DE_PRUEBA',COPEC_CLIENTE_ID:'123456789012'};
const fixture=(id,clock,medio='STORAGE')=>({turnoId:20261014,transaccionId:id,transaccionFechaCierre:Math.floor(Date.parse(`2026-10-14T${clock}Z`)/1000),fecha:'2026-10-14',codigoEds:'40098',transaccionTipo:'venta',operacionTipo:'asistido',formaPagoNombre:medio,productoDescripcion:'Diesel',categoriaNombre:'COMBUSTIBLE',clienteRutRut:'96963630-1',cantidad:300,precio:1497,total:449100});
test('POST de solo reporte utiliza token, turnoId y VENTA_COMBUSTIBLE',async()=>{
  let called;
  const fetchImpl=async(url,init)=>{called={url,init};return {ok:true,json:async()=>({data:{reportes:[{registros:[fixture('a','12:30:00'),fixture('p','13:00:00','EFECTIVO')]}]}})}};
  const r=await consultarCopecFuel('2026-10-14',{fetchImpl,env});
  assert.equal(called.init.method,'POST');
  assert.equal(called.init.headers.token,'TOKEN_DE_PRUEBA');
  assert.deepEqual(JSON.parse(called.init.body),{clienteId:'123456789012',turnoId:'20261014',tipoReporte:['VENTA_COMBUSTIBLE']});
  assert.equal(r.filas.length,2);
});
test('realiza snapshot de reporte sin escribir en proveedor',async()=>{
  const fetchImpl=async()=>({ok:true,json:async()=>({datos:{reporte:{transacciones:[fixture('a','23:49:59'),fixture('b','23:50:00'),fixture('c','22:45:00','EFECTIVO')]}}})});
  const s=await snapshotCopecFuel('2026-10-14',{fetchImpl,env});
  assert.equal(s.litros,300);assert.equal(s.consumos.length,1);assert.equal(s.precio,1497);
});
test('rechaza respuesta sin transacciones',()=>assert.throws(()=>extraerVentasCombustible({data:{transacciones:[]}}),/no devolvio arreglo/));
test('no utiliza host externo desconocido',async()=>assert.rejects(()=>consultarCopecFuel('2026-10-14',{env:{...env,COPEC_API_URL:'https://otro.local/reporte'},fetchImpl:()=>{throw new Error('Nunca llamar');}}),/Dominio API/));

test('diagnostico de codigoEds agrega solo conteos, no transacciones',()=>{
  const d=diagnosticarEds([fixture('a','12:30:00'),{...fixture('b','12:31:00'),codigoEds:undefined},
    {...fixture('c','12:32:00'),codigoEds:'99999'},
    {...fixture('d','23:50:00'),codigoEds:undefined}], '2026-10-14');
  assert.equal(d.eds40098Acreditada,1);assert.equal(d.edsAusente,1);assert.equal(d.edsDistinta,1);
  assert.equal(d.filasAntesDelCorte,3);assert.equal(JSON.stringify(d).includes('transaccion'),false);
});

test('Cuenta prefijos de transaccion sin exponer valores',()=>{
 const a={...fixture('a','12:00:00'),codigoEds:undefined,transaccionCodigo:'400980000008407290'};
 const b={...fixture('b','12:01:00'),codigoEds:undefined,transaccionCodigo:'300980000008407290'};
 const c={...fixture('c','12:02:00'),codigoEds:undefined};
 const d=diagnosticarEds([a,b,c],'2026-10-14');
 assert.equal(d.codigosConPrefijo40098,1);
 assert.equal(d.codigosConOtroPrefijo,1);
 assert.equal(d.codigosAusentes,1);
 assert.equal(JSON.stringify(d).includes('400980000008407290'),false);
});
test('Metadatos del reporte acreditan solo lo que informa el proveedor',()=>{
 const datos={data:{reporte:{codigoEds:'40098',clienteId:'123456789012',transacciones:[fixture('a','13:10:00')]}}};
 const d=diagnosticarOrigenReporte(datos,'123456789012');
 assert.equal(d.soloEds40098Declarada,true);
 assert.equal(d.clienteIdSolicitadoCoincide,true);
 assert.equal(JSON.stringify(d).includes('123456789012'),false);
});
test('ClienteId sin codigo de estacion no acredita EDS',()=>{
 const d=diagnosticarOrigenReporte({data:{clienteId:'123456789012',transacciones:[fixture('a','13:10:00')]}},'123456789012');
 assert.equal(d.clienteIdSolicitadoCoincide,true);
 assert.equal(d.codigoEdsDeclaradoEnSobre,false);
 assert.equal(d.soloEds40098Declarada,false);
});
test('Metadatos con dos estaciones no acreditan exclusividad',()=>{
 const d=diagnosticarOrigenReporte({data:{estaciones:[{codigoEds:'40098'},{codigoEds:'40099'}]}},'123456789012');
 assert.equal(d.soloEds40098Declarada,false);
 assert.equal(d.estacionesDistintasDeclaradas,2);
 assert.equal(d.existeOtraEdsDeclarada,true);
});
