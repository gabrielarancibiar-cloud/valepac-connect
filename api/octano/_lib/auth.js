import { createHash, timingSafeEqual } from "node:crypto";

/** Token específico de Octano. No reutiliza secretos de Supabase, Copec ni del worker. */
export function autenticarOctano(request) {
  const esperado = process.env.OCTANO_READ_TOKEN;
  if (!esperado || esperado.length < 32 || esperado.length > 256) {
    return { ok: false, status: 503, code: "OCTANO_NOT_CONFIGURED" };
  }

  const header = request.headers?.authorization || request.headers?.Authorization;
  if (typeof header !== "string") {
    return { ok: false, status: 401, code: "OCTANO_UNAUTHORIZED" };
  }
  const m = /^Bearer ([A-Za-z0-9_\-~.]+)$/.exec(header);
  if (!m || m[1].length < 32 || m[1].length > 256) {
    return { ok: false, status: 401, code: "OCTANO_UNAUTHORIZED" };
  }
  const hash = (s) => createHash("sha256").update(s, "utf8").digest();
  return timingSafeEqual(hash(esperado), hash(m[1]))
    ? { ok: true }
    : { ok: false, status: 401, code: "OCTANO_UNAUTHORIZED" };
}
