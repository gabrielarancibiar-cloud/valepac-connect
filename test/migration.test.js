import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('../supabase/migrations/002_precio_maximo_storage.sql',import.meta.url),'utf8');
test('la migración conserva el precio de cada carga STORAGE',()=>{
  assert.match(sql,/add column if not exists precio_unitario integer/i);
  assert.match(sql,/insert into public\.coseducam_consumos[\s\S]*?precio_unitario/i);
});
test('RPC verifica el máximo y no acepta horas posteriores al corte',()=>{
  assert.match(sql,/v_precio_max is distinct from p_precio/i);
  assert.match(sql,/max\(x\.precio_unitario\)/i);
  assert.match(sql,/x\.hora_venta >= '23:50:00'/i);
});
