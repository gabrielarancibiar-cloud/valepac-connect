export default async function handler(request, response) {
  if (request.method !== "GET") {
    return response.status(405).json({
      ok: false,
      error: "Método no permitido. Usa GET.",
    });
  }

  return response.status(200).json({
    ok: true,
    integracion: "copec",
    recurso: "movimientos-cartola",
    mensaje: "Backend de cartola funcionando correctamente.",
    conectado: false,
    movimientos: [],
    fechaConsulta: new Date().toISOString(),
  });
}
