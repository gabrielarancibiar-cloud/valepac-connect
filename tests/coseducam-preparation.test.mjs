import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createContext, SourceTextModule, SyntheticModule } from "node:vm";
import {
  manejarPreparacionWorker,
  fechaActualChile,
  fechaPreparacionValida,
} from "../server/coseducam/preparation.js";

const secreto = "solo-pruebas-locales-credencial-worker";
const ahora = new Date("2026-10-16T01:00:00Z"); // En Chile todavía es 15-10.
const headers = { "x-valepac-worker-secret": secreto };
const control = (extra = {}) => ({
  method: "GET", headers, query: { recurso: "control_worker_coseducam", fecha: "2026-10-15" }, ...extra,
});
const preparar = (extra = {}) => ({
  method: "POST", headers, query: {}, body: { accion: "preparar_worker_coseducam", fecha: "2026-10-15" }, ...extra,
});
const preparacionValida = () => ({
  id: 1, fecha: "2026-10-15", codigoEds: "40098", estado: "PREPARADA", snapshot: { litros: 20.5 },
});
const resultado = (extra = {}) => ({
  fecha: "2026-10-15", codigoEds: "40098", job: null, guia: null,
  consumo: {
    litros: 20.5, registros: 2,
    precioDieselObservado: { precio: 1099, repeticiones: 5, transaccionesRevisadas: 7, preciosDistintos: 2, sincronizadoEn: "2026-10-15T23:00:00Z" },
  },
  estadoControl: "LISTA_PARA_PREPARAR", preparacion: null, modificoDatos: false,
  emisionHabilitada: false, confirmacionHabilitada: false, ...extra,
});
function respuesta() {
  return {
    statusCode: null, body: null, headers: {},
    setHeader(clave, valor) { this.headers[clave] = valor; },
    status(estado) { this.statusCode = estado; return this; },
    json(body) { this.body = body; return this; },
  };
}
async function ejecutar(request, opciones = {}) {
  const res = respuesta();
  const llamadas = [];
  const supabaseAdmin = { async rpc(...args) { llamadas.push(args); return opciones.rpc || { data: resultado(), error: null }; } };
  const atendida = await manejarPreparacionWorker(request, res, { supabaseAdmin, secretoEsperado: secreto, ahora, ...opciones });
  return { res, llamadas, atendida };
}

test("corte, calendario real y fecha máxima usan America/Santiago", () => {
  assert.equal(fechaActualChile(ahora), "2026-10-15");
  assert.equal(fechaPreparacionValida("2026-10-15", ahora), true);
  for (const fecha of ["2026-10-14", "2026-10-16", "2026-11-31", "2026-13-01", "2026-02-29", "2026-10-15T00:00Z", " 2026-10-15", ["2026-10-15"], null]) {
    assert.equal(fechaPreparacionValida(fecha, ahora), false, `${fecha}`);
  }
  assert.equal(fechaPreparacionValida("2028-02-29", new Date("2028-03-02T12:00Z")), true);
});

test("GET consulta exactamente un RPC sin guardar y entrega precio observado", async () => {
  const { res, llamadas, atendida } = await ejecutar(control());
  assert.equal(atendida, true);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(llamadas, [["coseducam_preparar_v1", { p_fecha: "2026-10-15", p_guardar: false }]]);
  assert.equal(res.body.consumo.precioDieselObservado.precio, 1099);
  assert.equal(res.body.modificoDatos, false);
  assert.equal(res.body.emisionHabilitada, false);
  assert.equal(res.body.confirmacionHabilitada, false);
});

test("POST solo prepara por RPC y devuelve snapshot aislado", async () => {
  const snapshot = preparacionValida();
  const { res, llamadas } = await ejecutar(preparar(), {
    rpc: { data: resultado({ estadoControl: "PREPARADA", preparacion: snapshot, modificoDatos: true }), error: null },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(llamadas, [["coseducam_preparar_v1", { p_fecha: "2026-10-15", p_guardar: true }]]);
  assert.deepEqual(res.body.preparacion, snapshot);
  assert.equal(res.body.accion, "preparar_worker_coseducam");
});

test("motivo se propaga si existe y sigue siendo opcional", async () => {
  for (const extra of [{}, { motivo: "Guía existente: revisar sin emitir." }]) {
    const { res } = await ejecutar(control(), { rpc: { data: resultado(extra), error: null } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.motivo, extra.motivo);
    assert.equal(Object.hasOwn(res.body, "motivo"), Object.hasOwn(extra, "motivo"));
  }
});

test("PREPARADA exige snapshot válido y DATOS_CAMBIARON conserva preparación anterior", async () => {
  const inseguras = [null, [], {}, { ...preparacionValida(), estado: "PENDIENTE" }, { ...preparacionValida(), fecha: "2026-10-16" }, { ...preparacionValida(), codigoEds: "40099" }, { ...preparacionValida(), snapshot: null }, { ...preparacionValida(), snapshot: [] }];
  for (const preparacion of inseguras) {
    const { res } = await ejecutar(preparar(), { rpc: { data: resultado({ estadoControl: "PREPARADA", preparacion }), error: null } });
    assert.equal(res.statusCode, 503);
  }
  for (const preparacion of [null, [], "snapshot"]) {
    const { res } = await ejecutar(control(), { rpc: { data: resultado({ estadoControl: "DATOS_CAMBIARON", preparacion }), error: null } });
    assert.equal(res.statusCode, 503);
  }
  const { res } = await ejecutar(control(), { rpc: { data: resultado({ estadoControl: "PREPARADA", preparacion: preparacionValida() }), error: null } });
  assert.equal(res.statusCode, 200);
});

test("POST rechaza LISTA_PARA_PREPARAR aunque la RPC informe éxito", async () => {
  const { res } = await ejecutar(preparar(), { rpc: { data: resultado(), error: null } });
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.ok, false);
});

test("solo worker válido: falta, error, duplicado y secreto no configurado bloquean antes del RPC", async () => {
  for (const request of [control({ headers: {} }), control({ headers: { authorization: "Bearer humano" } }), control({ headers: { "x-valepac-worker-secret": "invalido", authorization: "Bearer humano" } }), control({ headers: { "x-valepac-worker-secret": "" } }), control({ headers: { "x-valepac-worker-secret": [secreto, secreto] } }), control({ headers: { "x-valepac-worker-secret": `${secreto} ` } })]) {
    const { res, llamadas, atendida } = await ejecutar(request);
    assert.equal(atendida, true);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(llamadas, []);
  }
  const { res, llamadas } = await ejecutar(control(), { secretoEsperado: "" });
  assert.equal(res.statusCode, 401);
  assert.deepEqual(llamadas, []);
});

test("worker no accede a emisión, confirmación, sync ni otras rutas manuales", async () => {
  const requests = [
    ...["crear_guia_coseducam", "confirmar_guia_coseducam", "sincronizar_copecfuel", "sincronizar_enruta", "guardar_tct_tae", "eliminar_tct_tae", "desconocida"].map((accion) => preparar({ body: { accion } })),
    control({ query: { tipo: "coseducam", periodo: "2026-10" } }),
    control({ query: { recurso: "sesion_coseducam" } }),
    { method: "PUT", headers, query: {} },
  ];
  for (const request of requests) {
    const { res, llamadas, atendida } = await ejecutar(request);
    assert.equal(atendida, true);
    assert.equal(res.statusCode, 403);
    assert.deepEqual(llamadas, []);
  }
});

test("rechaza fecha fuera del corte, futura, inexistente o múltiple sin consultar datos", async () => {
  for (const fecha of ["2026-10-14", "2026-10-16", "2026-11-31", ["2026-10-15", "2026-10-16"]]) {
    const { res, llamadas } = await ejecutar(preparar({ body: { accion: "preparar_worker_coseducam", fecha } }));
    assert.equal(res.statusCode, 400);
    assert.deepEqual(llamadas, []);
  }
});

test("rechaza EDS alternativa, flags y parámetros inesperados en cuerpo y consulta", async () => {
  for (const extra of [{ codigoEds: "40099" }, { codigoEds: 40098 }, { emitir: true }, { confirmar: false }, { dryRun: false }, { guardar: false }, { modo: "emitir" }]) {
    const { res, llamadas } = await ejecutar(preparar({ body: { accion: "preparar_worker_coseducam", fecha: "2026-10-15", ...extra } }));
    assert.equal(res.statusCode, 400);
    assert.deepEqual(llamadas, []);
  }
  for (const request of [control({ body: { emitir: true } }), control({ query: { recurso: "control_worker_coseducam", fecha: "2026-10-15", emitir: true } }), preparar({ query: { emitir: true } }), preparar({ body: "{\"accion\":\"preparar_worker_coseducam\"}" })]) {
    const { res, llamadas } = await ejecutar(request);
    assert.ok([400, 403].includes(res.statusCode));
    assert.deepEqual(llamadas, []);
  }
  assert.equal((await ejecutar(control({ query: { recurso: "control_worker_coseducam", fecha: "2026-10-15", codigoEds: "40098" } }))).res.statusCode, 200);
});

test("errores RPC y contratos inseguros cierran el control sin filtrar datos internos", async () => {
  const inseguros = [
    resultado({ emisionHabilitada: true }), resultado({ confirmacionHabilitada: true }),
    resultado({ fecha: "2026-10-16" }), resultado({ codigoEds: "40099" }),
    resultado({ modificoDatos: true }), resultado({ estadoControl: "EMITIR" }),
    resultado({ consumo: { litros: 20, registros: 2 } }),
  ];
  for (const data of inseguros) {
    const { res } = await ejecutar(control(), { rpc: { data, error: null } });
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.ok, false);
  }
  const { res } = await ejecutar(control(), { rpc: { data: null, error: { message: "detalle interno sensible" } } });
  assert.equal(res.statusCode, 503);
  assert.equal(JSON.stringify(res.body).includes("detalle interno"), false);
});

test("estados bloqueados/espera conservan observaciones sin habilitar emisión", async () => {
  for (const estadoControl of ["BLOQUEADA_REVISION", "ESPERANDO_CONSUMO", "ESPERANDO_PRECIO", "DATOS_CAMBIARON"]) {
    const data = resultado({ estadoControl, preparacion: estadoControl === "DATOS_CAMBIARON" ? preparacionValida() : null, consumo: { litros: ["BLOQUEADA_REVISION", "DATOS_CAMBIARON"].includes(estadoControl) ? null : 0, registros: 0, precioDieselObservado: null } });
    const { res } = await ejecutar(preparar(), { rpc: { data, error: null } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.estadoControl, estadoControl);
    assert.equal(res.body.modificoDatos, false);
    assert.equal(res.body.emisionHabilitada, false);
    assert.equal(res.body.confirmacionHabilitada, false);
  }
});

test("sin cabecera worker las rutas habituales siguen hacia autenticación humana", async () => {
  const { atendida, res, llamadas } = await ejecutar({ method: "POST", headers: { authorization: "Bearer humano" }, body: { accion: "crear_guia_coseducam" } });
  assert.equal(atendida, false);
  assert.equal(res.statusCode, null);
  assert.deepEqual(llamadas, []);
});

async function cargarControlador({ requireCoseducam, rpc }) {
  const source = await readFile(new URL("../api/conciliacion/muevo-empresa.js", import.meta.url), "utf8");
  const context = createContext({ console });
  const stubNoInvocable = () => { throw new Error("No se permite llamar un portal desde estas pruebas."); };
  const dependencias = {
    "../_lib/supabaseAdmin.js": { requireCoseducam, supabaseAdmin: { rpc } },
    "../../server/coseducam/preparation.js": { manejarPreparacionWorker: (req, res, deps) => manejarPreparacionWorker(req, res, { ...deps, ahora, secretoEsperado: secreto }) },
    "../copec/login.js": { iniciarSesionCopec: stubNoInvocable, obtenerTokenCopecActual: stubNoInvocable },
    "../../server/copecfuel/ventasOficiales.js": { obtenerVentasOficialesCopecFuel: stubNoInvocable },
    "../../server/poa/volumenes.js": { guardarVolumenesPoaCopecFuel: stubNoInvocable, guardarVolumenesPoaEnRuta: stubNoInvocable, obtenerPoaAnual: stubNoInvocable },
    "../../server/m2Lake/sync.js": { sincronizarM2LakeDia: stubNoInvocable },
  };
  const modulo = new SourceTextModule(source, { context });
  await modulo.link((nombre) => {
    const exports = dependencias[nombre];
    assert.ok(exports, `Importación desconocida: ${nombre}`);
    return new SyntheticModule(Object.keys(exports), function () {
      for (const [clave, valor] of Object.entries(exports)) this.setExport(clave, valor);
    }, { context });
  });
  await modulo.evaluate();
  return modulo.namespace.default;
}

test("controlador real intercepta worker antes de login y conserva sesión del operador humano", async () => {
  let logins = 0;
  const llamadas = [];
  const handler = await cargarControlador({
    async requireCoseducam() { logins += 1; return { rol: "operador_coseducam", usuario: { id: "humano", email: "operador@example.test" } }; },
    async rpc(...args) { llamadas.push(args); return { data: resultado(), error: null }; },
  });
  for (const request of [control({ headers: {} }), preparar({ body: { accion: "crear_guia_coseducam" } }), control({ headers: { "x-valepac-worker-secret": "incorrecto", authorization: "Bearer humano" }, query: { recurso: "sesion_coseducam" } })]) {
    const res = respuesta();
    await handler(request, res);
    assert.ok([401, 403].includes(res.statusCode));
  }
  assert.equal(logins, 0);
  assert.deepEqual(llamadas, []);
  const workerRes = respuesta();
  await handler(control(), workerRes);
  assert.equal(workerRes.statusCode, 200);
  assert.equal(logins, 0);
  const humanoRes = respuesta();
  await handler({ method: "GET", headers: { authorization: "Bearer humano" }, query: { recurso: "sesion_coseducam" } }, humanoRes);
  assert.equal(humanoRes.statusCode, 200);
  assert.equal(humanoRes.body.usuario.id, "humano");
  assert.equal(logins, 1);
  assert.equal(humanoRes.headers["Cache-Control"], "private, no-store");
});

test("controlador real valida snapshot y propaga motivo del POST sin alcanzar rutas manuales", async () => {
  let payload;
  const llamadas = [];
  const handler = await cargarControlador({
    async requireCoseducam() { throw new Error("Una petición worker no debe alcanzar login humano."); },
    async rpc(...args) { llamadas.push(args); return { data: payload, error: null }; },
  });
  payload = resultado({ estadoControl: "PREPARADA", preparacion: preparacionValida(), modificoDatos: true, motivo: "Preparación guardada; emisión deshabilitada." });
  const preparadaRes = respuesta();
  await handler(preparar(), preparadaRes);
  assert.equal(preparadaRes.statusCode, 200);
  assert.equal(preparadaRes.body.motivo, payload.motivo);
  assert.deepEqual(preparadaRes.body.preparacion, payload.preparacion);
  assert.equal(preparadaRes.body.emisionHabilitada, false);
  payload = resultado({ estadoControl: "PREPARADA", preparacion: null });
  const invalidaRes = respuesta();
  await handler(preparar(), invalidaRes);
  assert.equal(invalidaRes.statusCode, 503);
  payload = resultado();
  const pendienteRes = respuesta();
  await handler(preparar(), pendienteRes);
  assert.equal(pendienteRes.statusCode, 503);
  payload = resultado({ estadoControl: "DATOS_CAMBIARON", preparacion: preparacionValida(), motivo: "El consumo cambió después de preparar." });
  const cambiosRes = respuesta();
  await handler(control(), cambiosRes);
  assert.equal(cambiosRes.statusCode, 200);
  assert.equal(cambiosRes.body.motivo, payload.motivo);
  assert.equal(cambiosRes.body.modificoDatos, false);
  assert.deepEqual(llamadas, [
    ...Array.from({ length: 3 }, () => ["coseducam_preparar_v1", { p_fecha: "2026-10-15", p_guardar: true }]),
    ["coseducam_preparar_v1", { p_fecha: "2026-10-15", p_guardar: false }],
  ]);
});
