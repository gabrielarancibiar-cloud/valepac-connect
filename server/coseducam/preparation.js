import { createHash, timingSafeEqual } from "node:crypto";

export const CORTE_PREPARACION_COSEDUCAM = "2026-10-15";
export const EDS_PREPARACION_COSEDUCAM = "40098";
const RECURSO_CONTROL = "control_worker_coseducam";
const ACCION_PREPARAR = "preparar_worker_coseducam";
const RECURSO_CONTROL_V2 = "control_worker_coseducam_v2";
const ACCION_PREPARAR_V2 = "preparar_worker_coseducam_v2";
const RECURSO_PREVIEW_V2 = "previsualizar_reserva_worker_coseducam_v2";
const ESTADOS_CONTROL_V2 = new Set([
  "BLOQUEADA_REVISION", "ESPERANDO_CONSUMO", "ESPERANDO_CIERRE",
  "ESPERANDO_HORA_CORTE", "LISTA_PARA_PREPARAR", "PREPARADA", "DATOS_CAMBIARON",
]);
const ESTADOS_PREVIEW_V2 = new Set([
  "FUERA_DE_HORARIO", "FECHA_NO_AUTORIZADA", "PARAMETRO_INVALIDO",
  "GUIA_EXISTENTE", "JOB_EXISTENTE", "PREPARACION_NO_VALIDA",
  "SNAPSHOT_INCOMPATIBLE", "CIERRE_NO_ACREDITADO",
  "DATOS_COMERCIALES_INVALIDOS", "DATOS_NO_COINCIDEN",
  "LITROS_GUIA_INVALIDOS", "LISTA_PARA_RESERVAR",
]);
const CABECERA_WORKER = "x-valepac-worker-secret";
const ESTADOS_CONTROL = new Set([
  "BLOQUEADA_REVISION", "ESPERANDO_CONSUMO", "ESPERANDO_PRECIO",
  "LISTA_PARA_PREPARAR", "PREPARADA", "DATOS_CAMBIARON",
]);

const esObjeto = (valor) =>
  valor !== null && typeof valor === "object" && !Array.isArray(valor);
const responder = (respuesta, estado, code, error) =>
  respuesta.status(estado).json({ ok: false, code, error });

function cabeceraWorker(request) {
  const headers = request.headers || {};
  if (typeof headers.has === "function" && typeof headers.get === "function") {
    return { presente: headers.has(CABECERA_WORKER), valor: headers.get(CABECERA_WORKER) };
  }
  const clave = Object.keys(headers).find(
    (nombre) => nombre.toLowerCase() === CABECERA_WORKER,
  );
  return { presente: clave !== undefined, valor: clave === undefined ? undefined : headers[clave] };
}

// Los hashes tienen longitud fija: ninguna rama compara el contenido del secreto.
function secretoValido(recibido, esperado) {
  if (typeof recibido !== "string" || typeof esperado !== "string" || !recibido || !esperado) {
    return false;
  }
  const hash = (valor) => createHash("sha256").update(valor, "utf8").digest();
  return timingSafeEqual(hash(recibido), hash(esperado));
}

export function fechaActualChile(ahora = new Date()) {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(ahora);
  const valor = (tipo) => partes.find((parte) => parte.type === tipo).value;
  return `${valor("year")}-${valor("month")}-${valor("day")}`;
}

export function fechaPreparacionValida(fecha, ahora = new Date()) {
  if (typeof fecha !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false;
  const calendario = new Date(`${fecha}T12:00:00.000Z`);
  return (
    Number.isFinite(calendario.getTime()) &&
    calendario.toISOString().slice(0, 10) === fecha &&
    fecha >= CORTE_PREPARACION_COSEDUCAM &&
    fecha <= fechaActualChile(ahora)
  );
}

function argumentosValidos(request, guardar) {
  const query = request.query || {};
  const body = request.body;
  if (!esObjeto(query) || (body !== undefined && body !== null && !esObjeto(body))) return false;
  const argumentos = guardar ? body : query;
  const permitidos = new Set(guardar ? ["accion", "fecha", "codigoEds"] : ["recurso", "fecha", "codigoEds"]);
  if (!esObjeto(argumentos) || Object.keys(argumentos).some((clave) => !permitidos.has(clave))) return false;
  if (guardar ? Object.keys(query).length > 0 : body && Object.keys(body).length > 0) return false;
  return argumentos.codigoEds === undefined || argumentos.codigoEds === EDS_PREPARACION_COSEDUCAM;
}

function resultadoSeguro(data, fecha, guardar) {
  const consumo = data?.consumo;
  const preparacion = data?.preparacion;
  const precio = consumo?.precioDieselObservado;
  const precioValido = precio === null || (
    esObjeto(precio) && Number.isFinite(precio.precio) && precio.precio > 0 &&
    [precio.repeticiones, precio.transaccionesRevisadas, precio.preciosDistintos]
      .every((valor) => Number.isSafeInteger(valor) && valor >= 0) &&
    typeof precio.sincronizadoEn === "string"
  );
  return (
    esObjeto(data) &&
    data.fecha === fecha &&
    data.codigoEds === EDS_PREPARACION_COSEDUCAM &&
    data.emisionHabilitada === false &&
    data.confirmacionHabilitada === false &&
    typeof data.modificoDatos === "boolean" &&
    (guardar || data.modificoDatos === false) &&
    ESTADOS_CONTROL.has(data.estadoControl) &&
    (!guardar || data.estadoControl !== "LISTA_PARA_PREPARAR") &&
    (data.motivo === undefined || typeof data.motivo === "string") &&
    (preparacion === null || esObjeto(preparacion)) &&
    (data.estadoControl !== "PREPARADA" || (
      esObjeto(preparacion) && preparacion.estado === "PREPARADA" &&
      preparacion.fecha === fecha && preparacion.codigoEds === EDS_PREPARACION_COSEDUCAM &&
      esObjeto(preparacion.snapshot)
    )) &&
    (data.estadoControl !== "DATOS_CAMBIARON" || esObjeto(preparacion)) &&
    esObjeto(consumo) &&
    ((Number.isFinite(consumo.litros) && consumo.litros >= 0) ||
      (consumo.litros === null && ["BLOQUEADA_REVISION", "DATOS_CAMBIARON"].includes(data.estadoControl))) &&
    Number.isSafeInteger(consumo.registros) && consumo.registros >= 0 &&
    precioValido &&
    Object.hasOwn(data, "job") && Object.hasOwn(data, "guia") && Object.hasOwn(data, "preparacion")
  );
}


// Contrato V2: exige estructura comercial y control del cierre; jamás habilita emisión.
function resultadoSeguroV2(data, fecha, guardar) {
  if (!esObjeto(data) || data.fecha !== fecha || data.codigoEds !== EDS_PREPARACION_COSEDUCAM ||
      data.emisionHabilitada !== false || data.confirmacionHabilitada !== false ||
      typeof data.modificoDatos !== "boolean" || (!guardar && data.modificoDatos !== false) ||
      !ESTADOS_CONTROL_V2.has(data.estadoControl) ||
      (guardar && data.estadoControl === "LISTA_PARA_PREPARAR") ||
      !esObjeto(data.resumenComercial) || !esObjeto(data.controlCierre)) return false;
  const comercial = data.resumenComercial;
  const cierre = data.controlCierre;
  if (comercial.version !== 2 || comercial.fecha !== fecha ||
      comercial.codigoEds !== EDS_PREPARACION_COSEDUCAM ||
      comercial.fuente !== "COSEDUCAM_CONSUMOS_DATA_LAKE" ||
      comercial.criterioPrecio !== "MAX_PRECIO_STORAGE_COSEDUCAM" ||
      comercial.emisionHabilitada !== false ||
      cierre.fecha !== fecha || cierre.codigoEds !== EDS_PREPARACION_COSEDUCAM ||
      cierre.emisionHabilitada !== false ||
      typeof comercial.ok !== "boolean" || typeof cierre.ok !== "boolean" ||
      !Number.isSafeInteger(comercial.registrosTotales) || comercial.registrosTotales < 0 ||
      !Number.isSafeInteger(comercial.registrosIncluidos) || comercial.registrosIncluidos < 0 ||
      !Number.isSafeInteger(comercial.registrosExcluidos) || comercial.registrosExcluidos < 0 ||
      comercial.registrosIncluidos + comercial.registrosExcluidos > comercial.registrosTotales ||
      typeof comercial.litros !== "number" || !Number.isFinite(comercial.litros) ||
      comercial.litros < 0 ||
      (comercial.ok && (!Number.isFinite(comercial.precioMaximoTae) || comercial.precioMaximoTae <= 0))
  ) return false;
  const preparacion = data.preparacion;
  if (preparacion !== null && !esObjeto(preparacion)) return false;
  if (data.estadoControl === "PREPARADA" &&
      (!esObjeto(preparacion) || preparacion.estado !== "PREPARADA" ||
      !esObjeto(preparacion.snapshot) || preparacion.snapshot.version !== 2 ||
      preparacion.snapshot.fecha !== fecha ||
      preparacion.snapshot.codigoEds !== EDS_PREPARACION_COSEDUCAM)) return false;
  return true;
}

function resultadoPreviewV2(data) {
  if (!esObjeto(data) || data.reservado !== false ||
      !ESTADOS_PREVIEW_V2.has(data.estado) || typeof data.ok !== "boolean") return false;
  if (data.ok !== (data.estado === "LISTA_PARA_RESERVAR")) return false;
  return !data.ok || (
    data.modificoDatos === false &&
    Number.isFinite(data.litrosGuia) && data.litrosGuia > 0 &&
    Number.isFinite(data.precioTae) && data.precioTae > 0
  );
}

/**
 * Atiende únicamente control y preparación. Devuelve false solo para el acceso
 * humano habitual sin cabecera worker. Una credencial worker nunca llega a las
 * rutas manuales, ni se reintenta como usuario cuando el secreto es inválido.
 */
export async function manejarPreparacionWorker(request, response, {
  supabaseAdmin,
  secretoEsperado = process.env.COSEDUCAM_WORKER_SECRET,
  ahora = new Date(),
} = {}) {
  const worker = cabeceraWorker(request);
  const recurso = request.query?.recurso;
  const accion = request.body?.accion;
  const rutaControl = request.method === "GET" && recurso === RECURSO_CONTROL;
  const rutaPreparar = request.method === "POST" && accion === ACCION_PREPARAR;
  const rutaControlV2 = request.method === "GET" && recurso === RECURSO_CONTROL_V2;
  const rutaPrepararV2 = request.method === "POST" && accion === ACCION_PREPARAR_V2;
  const rutaPreviewV2 = request.method === "GET" && recurso === RECURSO_PREVIEW_V2;
  const solicitaWorker = [RECURSO_CONTROL, RECURSO_CONTROL_V2, RECURSO_PREVIEW_V2].includes(recurso) ||
    [ACCION_PREPARAR, ACCION_PREPARAR_V2].includes(accion);
  if (!worker.presente && !solicitaWorker) return false;

  if (!secretoValido(worker.valor, secretoEsperado)) {
    responder(response, 401, "COSEDUCAM_WORKER_UNAUTHORIZED", "Se requiere la credencial válida del worker interno.");
    return true;
  }
  if (!rutaControl && !rutaPreparar && !rutaControlV2 && !rutaPrepararV2 && !rutaPreviewV2) {
    responder(response, 403, "COSEDUCAM_WORKER_SCOPE_FORBIDDEN", "El worker solo puede consultar y preparar COSEDUCAM sin emisión.");
    return true;
  }
  const guardar = rutaPreparar || rutaPrepararV2;
  const version2 = rutaControlV2 || rutaPrepararV2 || rutaPreviewV2;
  if (!argumentosValidos(request, guardar)) {
    responder(response, 400, "COSEDUCAM_WORKER_ARGUMENTS_INVALID", "Solo se aceptan la ruta, fecha y EDS 40098; la preparación no admite opciones adicionales.");
    return true;
  }
  const fecha = (guardar ? request.body : request.query).fecha;
  if (!fechaPreparacionValida(fecha, ahora)) {
    responder(response, 400, "COSEDUCAM_WORKER_DATE_INVALID", "La fecha debe ser una fecha calendario desde 2026-10-15 hasta hoy en Chile.");
    return true;
  }
  try {
    if (rutaPreviewV2) {
      // p_reservar=false: vista previa sin INSERT/UPDATE ni TAE.
      const { data, error } = await supabaseAdmin.rpc("coseducam_reservar_tae_v2", {
        p_fecha: fecha, p_reservar: false,
      });
      if (error || !resultadoPreviewV2(data)) {
        throw new Error("Vista previa no disponible o contrato inseguro.");
      }
      response.status(200).json({
        ok: data.ok, estado: data.estado, reservado: false,
        ...(data.ok ? { litrosGuia: data.litrosGuia, precioTae: data.precioTae,
          modificoDatos: false } : {}),
        emisionHabilitada: false, confirmacionHabilitada: false,
      });
      return true;
    }
    // Preparación/comprobación V1 se conserva para compatibilidad.
    // Las rutas V2 no pueden degradarse silenciosamente a la V1.
    const { data, error } = await supabaseAdmin.rpc(
      version2 ? "coseducam_preparar_v2" : "coseducam_preparar_v1", {
        p_fecha: fecha, p_guardar: guardar,
      });
    if (error || !(version2 ? resultadoSeguroV2(data, fecha, guardar) :
      resultadoSeguro(data, fecha, guardar))) {
      throw new Error("Control de preparación no disponible o contrato inseguro.");
    }
    response.status(200).json({
      ok: true,
      accion: guardar ? (version2 ? ACCION_PREPARAR_V2 : ACCION_PREPARAR) :
        "control_worker_solo_lectura",
      fecha: data.fecha,
      codigoEds: data.codigoEds,
      ...(version2 ? { resumenComercial: data.resumenComercial,
        controlCierre: data.controlCierre } : {
        job: data.job, guia: data.guia, consumo: data.consumo,
      }),
      estadoControl: data.estadoControl,
      ...(typeof data.motivo === "string" ? { motivo: data.motivo } : {}),
      preparacion: data.preparacion,
      modificoDatos: data.modificoDatos,
      emisionHabilitada: false,
      confirmacionHabilitada: false,
    });
  } catch {
    responder(response, 503, "COSEDUCAM_PREPARATION_UNAVAILABLE", "No se pudo verificar la preparación; no ejecutar emisión ni confirmación.");
  }
  return true;
}
