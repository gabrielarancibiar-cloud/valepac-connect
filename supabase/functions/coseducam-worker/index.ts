// Etapa de preparación: no contiene llamadas de emisión, confirmación ni Daily Sync.
// El despliegue desde Dashboard requiere únicamente este archivo.
export const VERSION = "2026-10-15.5-preparacion-sin-emision";
const CORTE = "2026-10-15";
const WORKER = "coseducam-worker";
const EDS = "40098";
const ESTADOS = new Set(["BLOQUEADA_REVISION", "ESPERANDO_CONSUMO", "ESPERANDO_PRECIO",
  "LISTA_PARA_PREPARAR", "PREPARADA", "DATOS_CAMBIARON"]);

type Opciones = {
  env: (nombre: string) => string | undefined;
  fetch: typeof globalThis.fetch;
  ahora: () => Date;
  timeoutMs?: number;
};
type Json = Record<string, unknown>;

function chile(ahora: Date) {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(ahora);
  const p = Object.fromEntries(partes.map((x) => [x.type, x.value]));
  return { fecha: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}:${p.second}` };
}

function fechaValida(fecha: string, hoy: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || fecha < CORTE || fecha > hoy) return false;
  const instante = new Date(`${fecha}T12:00:00Z`);
  return Number.isFinite(instante.getTime()) && instante.toISOString().slice(0, 10) === fecha;
}

function iguales(a: string, b: string) {
  if (!a || a.length !== b.length) return false;
  let diferencia = 0;
  for (let i = 0; i < a.length; i++) diferencia |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferencia === 0;
}

function objeto(valor: unknown): valor is Json {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor);
}

function salida(datos: Json, status = 200) {
  return new Response(JSON.stringify({
    version: VERSION, worker: WORKER, fechaInicioOperacion: CORTE,
    ...datos,
    emisionHabilitada: false, confirmacionHabilitada: false,
    taeActivado: false, enrutaActivado: false,
  }), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

export function crearHandler(opciones: Opciones) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return salida({ ok: false, error: "Usar POST." }, 405);
    const url = new URL(request.url);
    for (const nombre of url.searchParams.keys()) {
      if (!["modo", "fecha"].includes(nombre) || url.searchParams.getAll(nombre).length !== 1) {
        return salida({ ok: false, error: "Parámetros no admitidos." }, 400);
      }
    }
    const modo = url.searchParams.get("modo") || "simulacion";
    if (!["simulacion", "control", "diagnostico", "preparar"].includes(modo)) {
      return salida({ ok: false, error: "Modo no disponible." }, 400);
    }
    const ahora = chile(opciones.ahora());
    // Sin modo explícito, también una llamada del cron antiguo queda sin operaciones.
    if (modo === "simulacion") return salida({
      ok: true, accion: "simulacion_sin_operaciones", fechaChile: ahora.fecha, horaChile: ahora.hora,
      modificoDatos: false,
    });

    // Misma puerta de pruebas de etapa 1. Nunca acepta la credencial del cron como sustituto.
    const esperado = opciones.env("DAILY_SYNC_TEST_TOKEN") || "";
    const recibido = request.headers.get("x-daily-test-token") || "";
    if (esperado.length < 16 || !iguales(recibido, esperado)) {
      return salida({ ok: false, accion: "no_autorizado" }, 403);
    }
    const fecha = url.searchParams.get("fecha") || ahora.fecha;
    if (!fechaValida(fecha, ahora.fecha)) {
      return salida({ ok: false, accion: "fecha_no_autorizada" }, 400);
    }
    // El llamador solo elige modo y fecha: ni precios, litros, EDS o banderas de emisión.
    try {
      const raw = await request.text();
      if (raw.length > 1024) return salida({ ok: false, error: "Cuerpo no admitido." }, 400);
      const body: unknown = raw.trim() ? JSON.parse(raw) : {};
      if (!objeto(body) || Object.keys(body).length !== 0) {
        return salida({ ok: false, error: "Enviar un objeto vacío; los datos se consultan en el servidor." }, 400);
      }
    } catch {
      return salida({ ok: false, error: "Cuerpo JSON inválido." }, 400);
    }

    let endpoint: URL;
    const secret = opciones.env("COSEDUCAM_WORKER_SECRET") || "";
    try {
      endpoint = new URL(opciones.env("VALEPAC_API_URL") || "");
      if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password ||
          endpoint.search || endpoint.hash ||
          !/^\/api\/conciliacion\/muevo-empresa(?:\.js)?$/.test(endpoint.pathname) || secret.length < 16) {
        throw new Error("Configuración inválida.");
      }
    } catch {
      return salida({ ok: false, accion: "configuracion_incompleta",
        requiere: ["VALEPAC_API_URL (HTTPS, endpoint de conciliación)", "COSEDUCAM_WORKER_SECRET (16 caracteres o más)"],
      }, 503);
    }

    const preparar = modo === "preparar";
    if (!preparar) {
      endpoint.searchParams.set("recurso", "control_worker_coseducam");
      endpoint.searchParams.set("fecha", fecha);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opciones.timeoutMs ?? 12_000);
    try {
      // No seguir redirecciones que pudieran reenviar la credencial a otro destino.
      // No reintentar una escritura cuya respuesta se haya perdido: la RPC es idempotente.
      const result = await opciones.fetch(endpoint.toString(), {
        method: preparar ? "POST" : "GET", redirect: "error", signal: controller.signal,
        headers: { Accept: "application/json", "Content-Type": "application/json",
          "x-valepac-worker-secret": secret },
        ...(preparar ? { body: JSON.stringify({ accion: "preparar_worker_coseducam", fecha }) } : {}),
      });
      const raw = await result.text();
      let data: unknown;
      try { data = JSON.parse(raw); } catch { data = null; }
      const estado = objeto(data) ? data.estadoControl : null;
      const prep = objeto(data) ? data.preparacion : null;
      const preparacionSegura = estado !== "PREPARADA" || (objeto(prep) &&
        prep.fecha === fecha && prep.codigoEds === EDS && prep.estado === "PREPARADA" && objeto(prep.snapshot));
      if (!result.ok || !objeto(data) || data.ok !== true || data.fecha !== fecha ||
          data.codigoEds !== EDS || typeof data.estadoControl !== "string" ||
          !ESTADOS.has(data.estadoControl) || !preparacionSegura ||
          (estado === "DATOS_CAMBIARON" && !objeto(prep)) ||
          (preparar && estado === "LISTA_PARA_PREPARAR") ||
          typeof data.modificoDatos !== "boolean" || (!preparar && data.modificoDatos) ||
          data.emisionHabilitada !== false || data.confirmacionHabilitada !== false ||
          !objeto(data.consumo)) {
        return salida({ ok: false, accion: "respuesta_vercel_no_validada", httpVercel: result.status,
          error: "Vercel no confirmó el contrato de preparación. Revisar despliegue y configuración.",
        }, 502);
      }
      return salida({
        ok: true, accion: preparar ? "preparacion_sin_emision" : "control_worker_solo_lectura",
        modo, fechaChile: ahora.fecha, horaChile: ahora.hora, fechaProceso: fecha,
        httpVercel: result.status, estadoControl: data.estadoControl,
        motivo: typeof data.motivo === "string" ? data.motivo : null,
        preparado: data.estadoControl === "PREPARADA", modificoDatos: data.modificoDatos,
        trabajo: data.job ?? null, guia: data.guia ?? null,
        consumo: data.consumo, preparacion: data.preparacion ?? null,
      });
    } catch {
      return salida({ ok: false, accion: "vercel_sin_respuesta_confirmada",
        error: controller.signal.aborted ? "Tiempo de espera agotado." : "No se pudo completar la consulta de Vercel.",
        resultadoDesconocido: preparar,
      }, 503);
    } finally {
      clearTimeout(timer);
    }
  };
}

if (typeof Deno !== "undefined") {
  Deno.serve(crearHandler({ env: (nombre) => Deno.env.get(nombre), fetch: globalThis.fetch, ahora: () => new Date() }));
}
