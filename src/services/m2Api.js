import { apiFetch } from "../lib/api.js";

async function payload(respuesta) {
  const datos = await respuesta.json().catch(() => null);
  if (!respuesta.ok || !datos?.ok) {
    let detalle = datos?.error;
    if (detalle && typeof detalle === "object") detalle = detalle.message || detalle.error || JSON.stringify(detalle);
    throw new Error(detalle || `La solicitud falló con estado ${respuesta.status}.`);
  }
  return datos;
}

export async function obtenerM2(periodo) {
  const params = new URLSearchParams({ periodo });
  return payload(await apiFetch(`/api/m2?${params.toString()}`, {
    method: "GET", headers: { Accept: "application/json" }, cache: "no-store",
  }));
}

export async function obtenerCostosBlueMax() {
  return payload(await apiFetch("/api/m2?recurso=bluemax-costos", {
    method: "GET", headers: { Accept: "application/json" }, cache: "no-store",
  }));
}

export async function guardarCostoBlueMax({ fechaVigencia, precioCosto, observacion = "" }) {
  return payload(await apiFetch("/api/m2?recurso=bluemax-costos", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ fechaVigencia, precioCosto, observacion }),
  }));
}

export async function eliminarCostoBlueMax(id) {
  const params = new URLSearchParams({ recurso: "bluemax-costos", id: String(id) });
  return payload(await apiFetch(`/api/m2?${params.toString()}`, {
    method: "DELETE", headers: { Accept: "application/json" },
  }));
}

export async function sincronizarM2LakeDia(fecha) {
  const params = new URLSearchParams({ recurso: "lake-sync" });
  return payload(await apiFetch(`/api/m2?${params.toString()}`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ fecha }),
  }));
}
