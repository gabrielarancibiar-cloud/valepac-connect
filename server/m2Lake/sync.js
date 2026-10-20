function fechaValida(valor) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(valor || ""));
}

function config() {
  const url = String(process.env.DATA_LAKE_APP_URL || "").trim().replace(/\/$/, "");
  const token = String(process.env.DATA_LAKE_INTERNAL_TOKEN || "").trim();
  if (!url || !token) {
    const error = new Error("Faltan DATA_LAKE_APP_URL o DATA_LAKE_INTERNAL_TOKEN en Vercel.");
    error.status = 503;
    throw error;
  }
  return { url, token };
}

export async function sincronizarM2LakeDia(fecha) {
  if (!fechaValida(fecha)) {
    const error = new Error("La fecha no es válida.");
    error.status = 400;
    throw error;
  }

  const { url, token } = config();
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "x-valepac-internal-token": token,
  };

  async function llamar(ruta, datos = { fecha }) {
    const res = await fetch(`${url}${ruta}`, {
      method: "POST",
      headers,
      body: JSON.stringify(datos),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.ok) {
      throw new Error(`${ruta}: ${body?.error || `HTTP ${res.status}`}`);
    }
    return body;
  }

  const archivado = await llamar("/api/archive");
  if (!/^[a-f0-9]{64}$/.test(String(archivado.sha256 || ""))) {
    throw new Error("Data Lake no confirmo la huella del JSON nuevo; no procesar.");
  }
  const procesado = await llamar("/api/process", {fecha, sha256Esperado: archivado.sha256});
  if (procesado.sha256 !== archivado.sha256 || procesado.recompraLake?.actualizado !== true ||
      !procesado.capturadoEn || !procesado.procesadoEn) {
    throw new Error("Data Lake no acredito procesamiento completo M2 y Recompra/COSEDUCAM.");
  }

  return {
    fecha,
    sha256: procesado.sha256,
    capturadoEn: procesado.capturadoEn,
    procesadoEn: procesado.procesadoEn,
    registros: Number(archivado.registros || 0),
    jsonBytes: Number(archivado.jsonBytes || 0),
    gzipBytes: Number(archivado.gzipBytes || 0),
    filasResumen: Number(procesado.filasResumen || 0),
    diagnostico: procesado.diagnostico || null,
    recompraLake: procesado.recompraLake || null,
  };
}
