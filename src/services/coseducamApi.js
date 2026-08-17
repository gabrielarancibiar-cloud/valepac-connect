import { apiFetch } from "../lib/api.js";

const RUTA_COSEDUCAM = "/api/conciliacion/muevo-empresa";

function numeroOpcional(valor) {
  const resultado = Number(valor);
  return Number.isFinite(resultado) ? resultado : undefined;
}

async function leerRespuesta(respuesta) {
  const payload = await respuesta.json().catch(() => null);

  if (!respuesta.ok || !payload?.ok) {
    const error = new Error(
      payload?.error || `La solicitud fallo con estado ${respuesta.status}.`
    );
    error.status = respuesta.status;
    error.requiereCapturaEnRuta = Boolean(payload?.requiereCapturaEnRuta);
    error.requiereCodigoEquipo = Boolean(payload?.requiereCodigoEquipo);
    error.requiereConfirmacionPrecio = Boolean(
      payload?.requiereConfirmacionPrecio
    );
    error.requiereSincronizacionPrecio = Boolean(
      payload?.requiereSincronizacionPrecio
    );
    // Banderas del flujo de guías TAE: permiten ofrecer la acción correcta en
    // vez de dejar el día sin salida.
    error.requiereConfirmacionLitros = Boolean(
      payload?.requiereConfirmacionLitros
    );
    error.requiereConfirmacionReintento = Boolean(
      payload?.requiereConfirmacionReintento
    );
    error.autorizacionEnviada = Boolean(payload?.autorizacionEnviada);
    error.puedeReintentar = Boolean(payload?.puedeReintentar);
    error.tiempoAgotado = Boolean(payload?.tiempoAgotado);
    error.precioPortal = numeroOpcional(payload?.precioPortal);
    error.precioObservado = numeroOpcional(payload?.precioObservado);
    error.litrosGuia = numeroOpcional(payload?.litrosGuia);
    error.litrosEsperados = numeroOpcional(payload?.litrosEsperados);
    error.litrosCalculados = numeroOpcional(payload?.litrosCalculados);
    error.numeroGuia = payload?.numeroGuia || null;
    error.codigoAutorizacion = payload?.codigoAutorizacion || null;
    error.guiaExistente = payload?.guiaExistente || null;
    throw error;
  }

  return payload;
}

export async function obtenerCoseducam(periodo, codigoEds) {
  const params = new URLSearchParams({ periodo, tipo: "coseducam" });

  if (codigoEds) params.set("codigoEds", String(codigoEds));

  const respuesta = await apiFetch(`${RUTA_COSEDUCAM}?${params.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  return leerRespuesta(respuesta);
}

export async function importarLitrosCoseducam(fecha) {
  const respuesta = await apiFetch(RUTA_COSEDUCAM, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      accion: "sincronizar_copecfuel",
      fecha,
    }),
  });

  return leerRespuesta(respuesta);
}

/**
 * Crea la guía TAE del día. `litrosEsperados` viaja como control: si el
 * servidor recalcula un entero distinto al que se mostró en pantalla, responde
 * pidiendo confirmación en lugar de emitir una guía por otra cantidad.
 */
export async function crearGuiaCoseducam({
  fecha,
  direccion,
  codigoEds,
  litrosEsperados,
  confirmarPrecioObservado = false,
  confirmarLitros = false,
  reintentar = false,
}) {
  const respuesta = await apiFetch(RUTA_COSEDUCAM, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      accion: reintentar
        ? "reintentar_guia_coseducam"
        : "crear_guia_coseducam",
      fecha,
      direccion,
      codigoEds,
      litrosEsperados: numeroOpcional(litrosEsperados),
      confirmarPrecioObservado,
      confirmarLitros,
    }),
  });

  return leerRespuesta(respuesta);
}

/**
 * Repite la creación de un día que quedó en revisión. Reutiliza la misma fila
 * en Supabase, de modo que la fecha nunca queda bloqueada.
 */
export async function reintentarGuiaCoseducam(parametros) {
  return crearGuiaCoseducam({ ...parametros, reintentar: true });
}

export async function confirmarGuiaCoseducam({ fecha, guiaId }) {
  const respuesta = await apiFetch(RUTA_COSEDUCAM, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      accion: "confirmar_guia_coseducam",
      fecha,
      guiaId,
    }),
  });

  return leerRespuesta(respuesta);
}
