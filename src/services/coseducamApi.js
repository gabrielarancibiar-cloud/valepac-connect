async function leerRespuesta(respuesta) {
  const payload = await respuesta.json().catch(() => null);

  if (!respuesta.ok || !payload?.ok) {
    const error = new Error(
      payload?.error || `La solicitud fallo con estado ${respuesta.status}.`
    );
    error.status = respuesta.status;
    error.requiereCapturaEnRuta = Boolean(payload?.requiereCapturaEnRuta);
    throw error;
  }

  return payload;
}

export async function obtenerCoseducam(periodo) {
  const params = new URLSearchParams({ periodo, tipo: "coseducam" });
  const respuesta = await fetch(
    `/api/conciliacion/muevo-empresa?${params.toString()}`,
    {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    }
  );

  return leerRespuesta(respuesta);
}

export async function crearGuiaCoseducam({ fecha, direccion, codigoEds }) {
  const respuesta = await fetch("/api/conciliacion/muevo-empresa", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      accion: "crear_guia_coseducam",
      fecha,
      direccion,
      codigoEds,
    }),
  });

  return leerRespuesta(respuesta);
}

export async function confirmarGuiaCoseducam({ fecha, guiaId }) {
  const respuesta = await fetch("/api/conciliacion/muevo-empresa", {
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
