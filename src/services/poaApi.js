import { apiFetch } from "../lib/api.js";

async function leerRespuesta(respuesta) {
  const payload = await respuesta.json().catch(() => null);

  if (!respuesta.ok || !payload?.ok) {
    const error = new Error(
      payload?.error || `La solicitud falló con estado ${respuesta.status}.`
    );
    error.status = respuesta.status;
    throw error;
  }

  return payload;
}

export async function obtenerPoaVolumenes(anio, codigoEds = "") {
  const params = new URLSearchParams({
    tipo: "poa",
    anio: String(anio),
  });

  if (codigoEds) params.set("codigoEds", codigoEds);

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
