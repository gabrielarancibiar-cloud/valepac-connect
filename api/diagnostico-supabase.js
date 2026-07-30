function decodificarJwt(token) {
  try {
    const partePayload = token.split(".")[1];

    const base64 = partePayload
      .replace(/-/g, "+")
      .replace(/_/g, "/");

    const payload = Buffer.from(base64, "base64").toString("utf8");

    return JSON.parse(payload);
  } catch {
    return null;
  }
}

export default async function handler(request, response) {
  const clave = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const url = process.env.SUPABASE_URL || "";

  const payload = decodificarJwt(clave);

  return response.status(200).json({
    tieneUrl: Boolean(url),
    dominioProyecto: url
      ? new URL(url).hostname
      : null,
    claveDetectada: Boolean(clave),
    rolClave: payload?.role || null,
    referenciaProyecto: payload?.ref || null,
    emisor: payload?.iss || null,
    expiracion: payload?.exp
      ? new Date(payload.exp * 1000).toISOString()
      : null,
  });
}
