// VALEPAC Daily Sync v3 — Control persistente mediante Vercel.
// No utiliza RPC ni PostgREST directamente. No modifica coseducam-worker.
// MODO PREDETERMINADO: simulacion, sin escrituras.

const VERSION = "2026-10-15.6-prueba-manual-controlada";
const WORKER = "valepac-daily-sync";
const ZONA = "America/Santiago";

function relojChile() {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date());
  const p = Object.fromEntries(partes.filter(x => x.type !== "literal").map(x => [x.type, x.value]));
  return {
    fecha: `${p.year}-${p.month}-${p.day}`,
    hora: `${p.hour}:${p.minute}:${p.second}`,
    ventana: p.hour === "08" || p.hour === "09"
  };
}

function fechaMenos(fecha: string, dias: number) {
  const [anio, mes, dia] = fecha.split("-").map(Number);
  const d = new Date(Date.UTC(anio, mes - 1, dia, 12));
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}

function responder(datos: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify({ version: VERSION, worker: WORKER, ...datos }, null, 2), {
    status, headers: {"Content-Type": "application/json", "Cache-Control": "no-store"}
  });
}

function config() {
  const base = (Deno.env.get("VALEPAC_BASE_URL") || "").trim().replace(/\/+$/, "");
  const secret = Deno.env.get("COSEDUCAM_WORKER_SECRET") || "";
  if (!/^https:\/\/[^/]+$/.test(base) || !secret)
    throw new Error("Faltan o son inválidos VALEPAC_BASE_URL / COSEDUCAM_WORKER_SECRET");
  return { base, secret };
}

// Una sola solicitud por operación; un timeout puede dejar una escritura completada.
async function post(url: string, secret: string, datos?: unknown, limiteMs = 35000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limiteMs);
  try {
    const respuesta = await fetch(url, {
      method: "POST", signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-valepac-worker-secret": secret
      },
      body: JSON.stringify(datos ?? {})
    });
    const texto = await respuesta.text();
    let json: any;
    try { json = texto ? JSON.parse(texto) : {}; }
    catch { throw new Error(`Respuesta no JSON, HTTP ${respuesta.status}`); }
    if (!respuesta.ok || json?.ok === false) {
      throw new Error(String(json?.error || json?.message || `HTTP ${respuesta.status}`).slice(0, 250));
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

// Inspecciona el payload real de Vercel antes de marcar un paso como completo.
// Los procesos manuales siguen fuera de este controlador y no se limitan.
function validarResultado(tipo: string, datos: any): string[] {
  const fallos: string[] = [];
  if (!datos || typeof datos !== "object" || datos.ok !== true) {
    fallos.push("Respuesta principal sin confirmación ok:true");
    return fallos;
  }
  if (tipo === "copecfuel") {
    const m2 = datos.m2Lake;
    if (!m2 || typeof m2 !== "object" || m2.actualizado === false || m2.error) {
      fallos.push("M2 Data Lake no confirmó ejecución completa");
    }
    // La recompra es parte del procesamiento Lake. La ausencia de datos del
    // módulo no es equivalente a una confirmación de éxito.
    const recompra = datos.recompraLake ?? m2?.recompraLake;
    if (!recompra || recompra.actualizado === false || recompra.error || recompra.ok === false) {
      fallos.push("Recompra Lake no confirmó actualización");
    }
    const poa = datos.poa;
    if (!poa || poa.actualizado !== true || poa.error) {
      fallos.push("POA no confirmó actualización");
    }
    const productos = datos.eerrProductos;
    if (!productos || productos.actualizado === false || productos.error || !Number.isFinite(Number(productos.registros))) {
      fallos.push("EE.RR. Productos no confirmó actualización");
    }
  } else if (tipo === "portal") {
    for (const campo of ["facturasError", "preciosCostoError", "fluctuacionesRecompraError"]) {
      if (datos[campo]) fallos.push(`Portal Copec reportó ${campo}`);
    }
  }
  return fallos;
}

Deno.serve(async request => {
  if (request.method !== "POST") return responder({ok:false,error:"Usar POST"}, 405);
  const chile = relojChile();
  const modo = new URL(request.url).searchParams.get("modo") || "simulacion";
  const fechas = [3,2,1,0].map(i => fechaMenos(chile.fecha, i));
  const baseInfo = {
    fechaChile: chile.fecha, horaChile: chile.hora, horaProgramada: "08:00",
    diasAProcesar: 4
  };

  if (modo === "simulacion") {
    return responder({...baseInfo, ok:true, accion:"simulacion_sin_sincronizar",
      fechas, pasosPrevistos:5, copecfuel:"NO EJECUTADO", portalCopec:"NO EJECUTADO"});
  }

  const esPruebaManual = modo === "prueba_manual";
  if (modo !== "automatico" && !esPruebaManual)
    return responder({...baseInfo,ok:false,error:"Modo desconocido"},400);

  if (esPruebaManual) {
    // Solo 15 de octubre y exclusivamente paso ID1 del 12 de octubre.
    // No reutilizar esta versión en días siguientes para pruebas históricas.
    const tokenEsperado = Deno.env.get("DAILY_SYNC_TEST_TOKEN") || "";
    const tokenRecibido = request.headers.get("x-daily-test-token") || "";
    const autorizado = Deno.env.get("DAILY_SYNC_PRUEBA_REAL_HABILITADA") === "true"
      && tokenEsperado.length >= 16 && tokenRecibido.length === tokenEsperado.length
      && tokenRecibido === tokenEsperado;
    const confirmacion = new URL(request.url).searchParams.get("confirmar") === "COPECFUEL-2026-10-12";
    if (!autorizado || !confirmacion || chile.fecha !== "2026-10-15") {
      return responder({...baseInfo,ok:false,accion:"prueba_manual_no_autorizada"},403);
    }
  } else {
    if (Deno.env.get("DAILY_SYNC_AUTO_HABILITADO") !== "true")
      return responder({...baseInfo,ok:true,accion:"automatico_desactivado"});
    if (!chile.ventana) return responder({...baseInfo,ok:true,accion:"fuera_de_horario"});
  }

  let cfg: ReturnType<typeof config>;
  try { cfg = config(); }
  catch { return responder({...baseInfo,ok:false,accion:"error_configuracion"},500); }

  // No constituye una nueva función de Vercel Hobby; reutiliza CopecFuel.
  const controlador = `${cfg.base}/api/copecfuel/sincronizar?daily_control=1`;
  let trabajo: any = null;
  try {
    await post(controlador, cfg.secret, {action:"schedule",runDate:chile.fecha}, 12000);
    trabajo = await post(controlador, cfg.secret, {action:"claim",runDate:chile.fecha}, 12000);

    if (trabajo?.state !== "claimed") {
      return responder({...baseInfo,ok:true,accion:trabajo?.state || "sin_trabajo"});
    }

    const fecha = String(trabajo.step_date || "");
    const tipo = String(trabajo.step_type || "");
    const id = Number(trabajo.id);
    const token = String(trabajo.token || "");
    if (esPruebaManual && (id !== 1 || fecha !== "2026-10-12" || tipo !== "copecfuel")) {
      // Si la cola cambió, NO procesar otro paso inesperado.
      // Dejarlo running para intervención manual (no repetir automáticamente).
      return responder({...baseInfo,ok:false,accion:"paso_inesperado_no_ejecutado",
        id,fecha,tipo,error:"No se enviaron ventas; revisar y liberar claim manualmente."},409);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !["copecfuel","portal"].includes(tipo) ||
        !Number.isSafeInteger(id) || !token) {
      // El trabajo queda running para revisión manual; nunca repetir silenciosamente.
      return responder({...baseInfo,ok:false,accion:"claim_invalido_revisar",id},503);
    }

    let ruta: string;
    if (tipo === "copecfuel") {
      ruta = `/api/copecfuel/sincronizar?desde=${encodeURIComponent(fecha)}&hasta=${encodeURIComponent(fecha)}`;
    } else {
      const [anio, mes] = fecha.split("-");
      ruta = `/api/copec/sincronizar?periodo=${encodeURIComponent(`${mes};${anio}`)}&fecha_desde=${encodeURIComponent(fecha)}`;
    }

    try {
      const datos = await post(`${cfg.base}${ruta}`, cfg.secret, {}, 35000);
      const fallosParciales = validarResultado(tipo, datos);
      if (fallosParciales.length) {
        throw new Error(`Respuesta HTTP exitosa pero con módulos incompletos: ${fallosParciales.join("; ")}`);
      }
    } catch (error) {
      const detalle = error instanceof Error ? error.message : "Error desconocido";
      try {
        await post(controlador, cfg.secret, {
          action:"finish",runDate:chile.fecha,id,token,ok:false,error:detalle
        }, 12000);
      } catch {
        return responder({...baseInfo,ok:false,accion:"running_requiere_revision",
          id, fecha, tipo, error:"No fue posible guardar el resultado: revisar manualmente."},503);
      }
      return responder({...baseInfo,ok:false,accion:"revision_requerida",id,fecha,tipo,
        error:"La escritura remota puede haber continuado; revisar antes de repetir."},502);
    }

    try {
      await post(controlador, cfg.secret, {action:"finish",runDate:chile.fecha,id,token,ok:true}, 12000);
    } catch {
      return responder({...baseInfo,ok:false,accion:"running_requiere_revision",
        id,fecha,tipo,error:"Vercel respondió correctamente, pero no se guardó la finalización."},503);
    }
    return responder({...baseInfo,ok:true,accion:"paso_completado",id,fecha,tipo});
  } catch {
    return responder({...baseInfo,ok:false,accion:"control_no_disponible",
      error:trabajo ? "Revisar estado del trabajo antes de repetir." : "No se pudo confirmar programación o bloqueo."},503);
  }
});
