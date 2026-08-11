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

function convertirMesAFormatoCopec(periodo) {
  const coincidencia = String(periodo || "").match(/^(\d{4})-(\d{2})$/);

  if (!coincidencia) {
    return periodo || "";
  }

  return `${coincidencia[2]};${coincidencia[1]}`;
}

export async function obtenerAbonosCopec({ limite = 100, periodo } = {}) {
  const params = new URLSearchParams({ limite: String(limite) });

  if (periodo) {
    params.set("periodo", convertirMesAFormatoCopec(periodo));
  }

  const respuesta = await apiFetch(`/api/copec/abonos?${params.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  return leerRespuesta(respuesta);
}

export async function sincronizarAbonosCopec(
  periodoSeleccionado,
  fechaDesde
) {
  const fecha = new Date();
  const periodo = periodoSeleccionado
    ? convertirMesAFormatoCopec(periodoSeleccionado)
    : `${String(fecha.getMonth() + 1).padStart(2, "0")};${fecha.getFullYear()}`;
  const params = new URLSearchParams({ periodo });

  if (fechaDesde) {
    params.set("fecha_desde", fechaDesde);
  }
  const respuesta = await apiFetch(
    `/api/copec/sincronizar?${params.toString()}`,
    {
      method: "POST",
      headers: { Accept: "application/json" },
    }
  );

  return leerRespuesta(respuesta);
}
