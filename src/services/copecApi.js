async function leerRespuesta(respuesta) {
  const payload = await respuesta.json().catch(() => null);

  if (!respuesta.ok || !payload?.ok) {
    throw new Error(
      payload?.error || `La solicitud falló con estado ${respuesta.status}.`
    );
  }

  return payload;
}

export async function obtenerAbonosCopec({ limite = 100 } = {}) {
  const params = new URLSearchParams({ limite: String(limite) });
  const respuesta = await fetch(`/api/copec/abonos?${params.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  return leerRespuesta(respuesta);
}

export async function sincronizarAbonosCopec() {
  const fecha = new Date();
  const periodo = `${String(fecha.getMonth() + 1).padStart(2, "0")};${fecha.getFullYear()}`;
  const params = new URLSearchParams({ periodo });
  const respuesta = await fetch(
    `/api/copec/sincronizar?${params.toString()}`,
    {
      method: "POST",
      headers: { Accept: "application/json" },
    }
  );

  return leerRespuesta(respuesta);
}
