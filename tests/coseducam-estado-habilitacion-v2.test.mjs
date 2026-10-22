import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluarEstadoTaeV2 } from '../server/coseducam/estadoHabilitacionV2.js';

const base = {
  fecha:'2026-10-22', fechaChile:'2026-10-22', horaChile:'23:56:32',flagTae:true,
  comercial:{ok:true,litros:1100,precioMaximoTae:1497,estado:'DATOS_COMERCIALES_VALIDOS'},
  cierre:{ok:true,estado:'CIERRE_VALIDADO'},
  preparacion:{estadoControl:'LISTA_PARA_PREPARAR'},
};

test('Datos aptos muestran prevalidacion lista sin emitir', () => {
  const r=evaluarEstadoTaeV2(base);
  assert.equal(r.listoParaSolicitarTae,true);
  assert.equal(r.bloqueos.length,0);
});
test('El flag desactivado bloquea, aunque cierre y hora sean correctos', () => {
  const r=evaluarEstadoTaeV2({...base,flagTae:false});
  assert.equal(r.listoParaSolicitarTae,false);
  assert.equal(r.bloqueos[0].codigo,'vercelTae');
});
test('Fecha historica bloqueada sin excepcion', () => {
  const r=evaluarEstadoTaeV2({...base,fecha:'2026-10-21'});
  assert.equal(r.flags.fechaOperacional,false);
});
test('Antes de las 23:50 bloqueado incluso con variable true', () => {
  const r=evaluarEstadoTaeV2({...base,horaChile:'23:49:59'});
  assert.equal(r.flags.horaDesdeCorte,false);
});
test('Sin consumo real bloqueado', () => {
  const r=evaluarEstadoTaeV2({...base,comercial:{ok:false,litros:0,precioMaximoTae:null,estado:'SIN_CONSUMOS'}});
  assert.equal(r.flags.consumosValidos,false);
});
test('Sin control de cierre válido bloqueado', () => {
  const r=evaluarEstadoTaeV2({...base,cierre:{ok:false,estado:'CAPTURA_ANTERIOR_AL_CORTE'}});
  assert.equal(r.flags.cierreAcreditado,false);
});
test('Falla de preparación V2 bloqueada', () => {
  const r=evaluarEstadoTaeV2({...base,preparacion:{estadoControl:'REVISION_REQUERIDA'}});
  assert.equal(r.flags.preparacionLista,false);
});
