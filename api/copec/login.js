export default async function handler(request, response) {
  if (request.method !== "POST") {
    return response.status(405).json({
      ok: false,
      error: "Método no permitido. Usa POST.",
    });
  }

  return response.status(200).json({
    ok: true,
    integracion: "copec",
    mensaje: "Endpoint de autenticación preparado.",
    configurado: false,
  });
}
