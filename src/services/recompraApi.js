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
