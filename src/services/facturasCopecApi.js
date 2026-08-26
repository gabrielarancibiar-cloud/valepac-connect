import { apiFetch } from "../lib/api.js";

async function leerRespuesta(respuesta) {
  const payload = await respuesta.json().catch(() => null);

  if (!respuesta.ok || !payload?.ok) {
    throw new Error(
      payload?.error || `La solicitud falló con estado ${respuesta.status}.`
    );
  }

  return payload;
}

function convertirPeriodo(periodo) {
  const coincidencia = String(periodo || "").match(/^(\d{4})-(\d{2})$/);
  return coincidencia ? `${coincidencia[2]};${coincidencia[1]}` : periodo;
}

export async function obtenerFacturasPortalCopec(periodo) {
  const params = new URLSearchParams({
    recurso: "facturas",
    periodo: convertirPeriodo(periodo),
  });
  const respuesta = await apiFetch(`/api/copec/abonos?${params}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  return leerRespuesta(respuesta);
}

export async function clasificarFacturaPortalCopec(id, categoria) {
  const respuesta = await apiFetch("/api/copec/abonos", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ accion: "clasificar_factura", id, categoria }),
  });

  return leerRespuesta(respuesta);
}

export async function obtenerDocumentoFacturaPortalCopec(id) {
  const params = new URLSearchParams({
    recurso: "documento_factura",
    id,
  });
  const respuesta = await apiFetch(`/api/copec/abonos?${params}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  return leerRespuesta(respuesta);
}

export async function analizarFacturasPortalCopec(
  periodo,
  limite = 3,
  reclasificar = false
) {
  const respuesta = await apiFetch("/api/copec/abonos", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      accion: "analizar_facturas",
      periodo: convertirPeriodo(periodo),
      limite,
      reclasificar,
    }),
  });

  return leerRespuesta(respuesta);
}
