import { autenticarOctano } from "./auth.js";
import { consultaOctano } from "./query.js";
import { obtenerLectura } from "./read.js";

/** Sólo GET; ni body ni nombres de acción admitidos. */
export function crearHandlerOctano(modulo, reader) {
  return async function handler(request, response) {
    response.setHeader("Cache-Control", "private, no-store, max-age=0");
    response.setHeader("Vary", "Authorization");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Robots-Tag", "noindex, nofollow");
    response.setHeader("Allow", "GET");

    if (request.method !== "GET") {
      return response.status(405).json({ ok: false, code: "METHOD_NOT_ALLOWED" });
    }
    const autorizacion = autenticarOctano(request);
    if (!autorizacion.ok) {
      return response.status(autorizacion.status).json({ ok: false, code: autorizacion.code });
    }

    let consulta;
    try {
      consulta = consultaOctano(request.query || {});
    } catch (error) {
      return response.status(400).json({ ok: false, code: "INVALID_QUERY", error: error.message });
    }

    try {
      const datos = await obtenerLectura(modulo, consulta, reader);
      return response.status(200).json({
        ok: true, modulo, periodo: consulta.periodo,
        ...(consulta.fecha ? { fecha: consulta.fecha } : {}),
        datos, fechaConsulta: new Date().toISOString(),
      });
    } catch (error) {
      console.error(`[octano/${modulo}] error de lectura:`, error);
      return response.status(error?.status === 400 ? 400 : 502).json({
        ok: false, code: error?.status === 400 ? "INVALID_QUERY" : "READ_FAILED",
        error: error?.status === 400 ? error.message : "No fue posible consultar los datos del módulo.",
      });
    }
  };
}
