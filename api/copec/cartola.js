const COPEC_API_URL =
  "https://portaldepago-api.copec.cl/pago/movimientos-cartola";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    return response.status(405).json({
      ok: false,
      error: "Método no permitido. Usa GET.",
    });
  }

  const token = process.env.COPEC_TOKEN;
  const rutConcesionario = process.env.COPEC_RUT_CONCESIONARIO;
  const idEds = process.env.COPEC_ID_EDS || "*";

  if (!token || !rutConcesionario) {
    return response.status(500).json({
      ok: false,
      error: "Faltan las variables COPEC_TOKEN o COPEC_RUT_CONCESIONARIO.",
    });
  }

  const periodo =
    typeof request.query.periodo === "string"
      ? request.query.periodo
      : null;

  const params = new URLSearchParams({
    rut_concesionario: rutConcesionario,
    id_eds: idEds,
  });

  if (periodo) {
    params.set("periodo", periodo);
  }

  try {
    const copecResponse = await fetch(`${COPEC_API_URL}?${params.toString()}`, {
      method: "GET",
      headers: {
        token,
        Accept: "application/json",
        Origin: "https://portaldepago.copec.cl",
        Referer: "https://portaldepago.copec.cl/",
      },
    });

    const rawText = await copecResponse.text();

    let payload;

    try {
      payload = JSON.parse(rawText);
    } catch {
      payload = {
        raw: rawText,
      };
    }

    if (!copecResponse.ok) {
      return response.status(copecResponse.status).json({
        ok: false,
        error: "La API de Copec rechazó la solicitud.",
        statusCopec: copecResponse.status,
        detalle: payload,
      });
    }

    const data = payload?.data ?? {};
    const movimientos = Array.isArray(data.MOVIMIENTOS)
      ? data.MOVIMIENTOS
      : [];

    const abonos = movimientos.filter((movimiento) => {
      const monto = Number(movimiento.ABONO || 0);
      return monto > 0;
    });

    const totalAbonos = abonos.reduce((total, movimiento) => {
      return total + Number(movimiento.ABONO || 0);
    }, 0);

    return response.status(200).json({
      ok: true,
      conectado: true,
      periodo: data.PERIODO ?? null,
      saldoAnterior: Number(data.SALDO_ANTERIOR || 0),
      cantidadMovimientos: movimientos.length,
      cantidadAbonos: abonos.length,
      totalAbonos,
      abonos,
      fechaConsulta: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error consultando Copec:", error);

    return response.status(500).json({
      ok: false,
      error: "No fue posible conectar con la API de Copec.",
      detalle: error instanceof Error ? error.message : "Error desconocido",
    });
  }
}
