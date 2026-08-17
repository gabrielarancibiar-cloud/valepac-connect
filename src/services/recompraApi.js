import { apiFetch } from "../lib/api.js";

async function leerRespuesta(respuesta) {
  const payload = await respuesta.json().catch(() => null);

  if (!respuesta.ok || !payload?.ok) {
    const error = new Error(
      payload?.error || `La solicitud fallo con estado ${respuesta.status}.`
    );
    error.status = respuesta.status;
    throw error;
  }

  return payload;
}

export async function obtenerRecompra(periodo) {
  const params = new URLSearchParams({ periodo, tipo: "recompra" });
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

export async function sincronizarVolumenPropio(periodo, fechaDesde) {
  const respuesta = await apiFetch("/api/conciliacion/muevo-empresa", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      accion: "sincronizar_enruta",
      periodo,
      fechaDesde,
    }),
  });

  return leerRespuesta(respuesta);
}

export async function descargarExcelEnRuta({
  fechaDesde,
  fechaHasta,
  codigoEds,
}) {
  const respuesta = await apiFetch("/api/conciliacion/muevo-empresa", {
    method: "POST",
    headers: {
      Accept: "application/vnd.ms-excel, application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      accion: "descargar_excel_enruta",
      fechaDesde,
      fechaHasta,
      codigoEds,
    }),
  });

  if (!respuesta.ok) {
    const payload = await respuesta.json().catch(() => null);
    throw new Error(
      payload?.error || `La descarga fallo con estado ${respuesta.status}.`
    );
  }

  const archivo = await respuesta.blob();
  const disposicion = respuesta.headers.get("Content-Disposition") || "";
  const nombreDetectado = disposicion.match(/filename="?([^";]+)"?/i)?.[1];
  const nombreArchivo =
    nombreDetectado ||
    `CopecEnRuta_${codigoEds}_${fechaDesde}_${fechaHasta}.xls`;
  const urlTemporal = URL.createObjectURL(archivo);
  const enlace = document.createElement("a");

  enlace.href = urlTemporal;
  enlace.download = nombreArchivo;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  window.setTimeout(() => URL.revokeObjectURL(urlTemporal), 1000);

  return { nombreArchivo, tamano: archivo.size };
}

export async function guardarTctTaeManual({ fecha, litros, referencia }) {
  const respuesta = await apiFetch("/api/conciliacion/muevo-empresa", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      accion: "guardar_tct_tae",
      fecha,
      litros,
      referencia,
    }),
  });

  return leerRespuesta(respuesta);
}

export async function eliminarTctTaeManual(id) {
  const respuesta = await apiFetch("/api/conciliacion/muevo-empresa", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ accion: "eliminar_tct_tae", id }),
  });

  return leerRespuesta(respuesta);
}
