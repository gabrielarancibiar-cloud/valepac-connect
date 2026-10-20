import { apiFetch } from "../lib/api.js";

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
    error.precioPortal = payload?.precioPortal;
    error.precioObservado = payload?.precioObservado;
    throw error;
  }

  return payload;
}

export async function obtenerCoseducam(periodo) {
  const params = new URLSearchParams({ periodo, tipo: "coseducam" });
  const respuesta = await apiFetch(
    `/api/conciliacion/muevo-empresa?${params.toString()}`,
    {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    }
  );

  return leerRespuesta(respuesta);
}

export async function importarLitrosCoseducam(fecha) {
  const respuesta = await apiFetch("/api/conciliacion/muevo-empresa", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      accion: "coseducam_v2_consultar",
      fecha,
    }),
  });

  return leerRespuesta(respuesta);
}

export async function crearGuiaCoseducam({ fecha, codigoEds }) {
  const respuesta = await apiFetch("/api/conciliacion/muevo-empresa", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      accion: "coseducam_v2_crear_tae",
      fecha,
      codigoEds,
    }),
  });

  return leerRespuesta(respuesta);
}

export async function confirmarGuiaCoseducam({ fecha, guiaId }) {
  const respuesta = await apiFetch("/api/conciliacion/muevo-empresa", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      accion: "coseducam_v2_confirmar_enruta",
      fecha,
      guiaId,
    }),
  });

  return leerRespuesta(respuesta);
}

// A diferencia de coseducam_v2_consultar, vuelve a obtener la API oficial,
// archiva un JSON.gz nuevo y procesa M2/Recompra/COSEDUCAM antes de refrescar.
export async function actualizarCoseducamDesdeCopecFuel(fecha) {
  const respuesta = await apiFetch("/api/conciliacion/muevo-empresa", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ accion: "coseducam_v2_actualizar", fecha }),
  });
  return leerRespuesta(respuesta);
}
