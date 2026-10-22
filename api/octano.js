import { crearHandlerOctano } from "./octano/_lib/handler.js";

// Una sola Vercel Function para cinco URL públicas, conservando la lógica
// y la autenticación de lectura ya implementadas en crearHandlerOctano().
// Las rutas públicas se resuelven mediante los rewrites de vercel.json.
const MODULOS = ["conciliacion", "recompra", "muevo", "resumen", "m2"];

export function crearRouterOctano(factory = crearHandlerOctano) {
  const rutas = Object.fromEntries(MODULOS.map((modulo) => [modulo, factory(modulo)]));

  return async function octano(request, response) {
    const modulo = request.query?.octano_modulo;
    if (typeof modulo !== "string" || !Object.hasOwn(rutas, modulo)) {
      response.setHeader("Cache-Control", "private, no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
      return response.status(404).json({ ok: false, code: "NOT_FOUND" });
    }
    return rutas[modulo](request, response);
  };
}

export default crearRouterOctano();
