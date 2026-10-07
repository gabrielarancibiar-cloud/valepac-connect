import { apiFetch } from "../lib/api.js";

async function payload(respuesta) {
  const datos = await respuesta.json().catch(() => null);
  if (!respuesta.ok || !datos?.ok) {
    throw new Error(datos?.error || `La solicitud falló con estado ${respuesta.status}.`);
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
