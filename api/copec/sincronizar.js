import { supabaseAdmin } from "../_lib/supabaseAdmin.js";
import {
  iniciarSesionCopec,
  obtenerTokenCopecActual,
} from "./login.js";

const COPEC_API_URL =
  "https://portaldepago-api.copec.cl/pago/movimientos-cartola";

function convertirNumero(valor) {
  if (valor === null || valor === undefined || valor === "") {
    return 0;
  }

  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : 0;
}
function convertirFecha(valor) {
  if (!valor) {
    return null;
  }

  const fecha = new Date(valor);

  if (Number.isNaN(fecha.getTime())) {
    return null;
  }

  return fecha.toISOString().slice(0, 10);
}

function textoClave(valor) {
  return String(valor ?? "").trim();
}

function montoClave(valor) {
  return convertirNumero(valor).toFixed(2);
}

function crearIdentificador(movimiento) {
  // El orden y algunos metadatos internos pueden cambiar entre consultas.
  // Esta clave usa solo datos visibles y estables del movimiento.
  return [
    "copec-v3",
    convertirFecha(movimiento.FECHA_MOVIMIENTO) || "",
    textoClave(
      movimiento.NUMERO_DOCUMENTO || movimiento.FACTURA_SD
    ),
    textoClave(
      movimiento.NUMERO_EDS || movimiento.NUMERO_OFICINA
    ),
    textoClave(movimiento.TIPO_DOCUMENTO || "ABONO"),
    montoClave(movimiento.ABONO),
  ].join("|");
}

async function consultarCartolaCopec(token, params) {
  const respuesta = await fetch(
    `${COPEC_API_URL}?${params.toString()}`,
    {
      method: "GET",
      headers: {
        token,
        Accept: "application/json",
        Origin: "https://portaldepago.copec.cl",
        Referer: "https://portaldepago.copec.cl/",
      },
    }
  );

  const texto = await respuesta.text();
  let payload = null;

  try {
    payload = JSON.parse(texto);
  } catch {
    // Un 401/403 puede venir sin JSON. Primero se renueva el token y se
    // valida el formato únicamente sobre la respuesta definitiva.
  }

  return { respuesta, payload };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");

  if (!["GET", "POST"].includes(request.method)) {
    return response.status(405).json({
      ok: false,
      error: "Método no permitido.",
    });
  }

  const rutConcesionario = process.env.COPEC_RUT_CONCESIONARIO;
  const idEds = process.env.COPEC_ID_EDS || "*";

  if (!rutConcesionario) {
    return response.status(500).json({
      ok: false,
      error: "Falta COPEC_RUT_CONCESIONARIO en Vercel.",
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

  let sincronizacionId = null;

  try {
    const { data: sincronizacion, error: errorInicio } = await supabaseAdmin
      .from("sincronizaciones")
      .insert({
        integracion: "copec",
        estado: "procesando",
        periodo,
        mensaje: "Consultando cartola Copec.",
      })
      .select("id")
      .single();

    if (errorInicio) {
      throw new Error(
        `No se pudo crear la sincronización: ${errorInicio.message}`
      );
    }

    sincronizacionId = sincronizacion.id;

    let token = obtenerTokenCopecActual();
    let tokenRenovado = false;
    let consulta;

    if (!token) {
      const sesion = await iniciarSesionCopec();
      token = sesion.accessToken;
      tokenRenovado = true;
    }

    consulta = await consultarCartolaCopec(token, params);

    if ([401, 403].includes(consulta.respuesta.status)) {
      const sesion = await iniciarSesionCopec();
      token = sesion.accessToken;
      tokenRenovado = true;

      // Único reintento permitido después de renovar el token.
      consulta = await consultarCartolaCopec(token, params);
    }

    if (!consulta.respuesta.ok) {
      throw new Error(
        `Copec rechazó la consulta con estado ${consulta.respuesta.status}.`
      );
    }

    if (!consulta.payload) {
      throw new Error("Copec respondió con un formato no válido.");
    }

    const datos = consulta.payload?.data ?? {};
    const movimientos = Array.isArray(datos.MOVIMIENTOS)
      ? datos.MOVIMIENTOS
      : [];

    const periodoRespuesta =
      datos.PERIODO || periodo || "sin-periodo";

    const abonos = movimientos.filter(
      (movimiento) => convertirNumero(movimiento.ABONO) > 0
    );

    const registrosPorIdentificador = new Map();

    for (const movimiento of abonos) {
      const identificadorOrigen = crearIdentificador(movimiento);

      registrosPorIdentificador.set(identificadorOrigen, {
        identificador_origen: identificadorOrigen,
        rut_concesionario: rutConcesionario,
        id_eds: String(
          movimiento.NUMERO_EDS ||
            movimiento.NUMERO_OFICINA ||
            idEds
        ),
        fecha_movimiento: convertirFecha(
          movimiento.FECHA_MOVIMIENTO
        ),
        fecha_contable: convertirFecha(
          movimiento.FECHA_CONTABLE ||
            movimiento.FECHA_VENCIMIENTO
        ),
        descripcion:
          movimiento.CLASIFICACION ||
          movimiento.LINEA_PRODUCTO ||
          movimiento.ESTADO ||
          "Abono Copec",
        referencia:
          movimiento.NUMERO_DOCUMENTO ||
          movimiento.FACTURA_SD ||
          null,
        tipo_movimiento:
          movimiento.TIPO_DOCUMENTO || "ABONO",
        monto: convertirNumero(movimiento.ABONO),
        saldo: convertirNumero(movimiento.SALDO),
        periodo: periodoRespuesta,
        datos_origen: movimiento,
        sincronizado_en: new Date().toISOString(),
      });
    }

    const registros = [...registrosPorIdentificador.values()];
    const duplicadosDescartados = abonos.length - registros.length;

    let registrosGuardados = 0;

    if (registros.length > 0) {
      const { data: guardados, error: errorGuardado } =
        await supabaseAdmin
          .from("copec_movimientos")
          .upsert(registros, {
            onConflict: "identificador_origen",
          })
          .select("id");

      if (errorGuardado) {
        throw new Error(
          `No se pudieron guardar los abonos: ${errorGuardado.message}`
        );
      }

      registrosGuardados = guardados?.length || 0;
    }

    const totalAbonos = registros.reduce(
      (total, registro) => total + registro.monto,
      0
    );

    await supabaseAdmin
      .from("sincronizaciones")
      .update({
        estado: "completado",
        periodo: periodoRespuesta,
        registros_encontrados: abonos.length,
        registros_guardados: registrosGuardados,
        mensaje: "Cartola sincronizada correctamente.",
        finalizado_en: new Date().toISOString(),
      })
      .eq("id", sincronizacionId);

    return response.status(200).json({
      ok: true,
      mensaje: "Cartola sincronizada correctamente.",
      periodo: periodoRespuesta,
      movimientosRecibidos: movimientos.length,
      abonosEncontrados: abonos.length,
      abonosUnicos: registros.length,
      duplicadosDescartados,
      registrosGuardados,
      totalAbonos,
      tokenRenovado,
      fechaSincronizacion: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error sincronizando Copec:", error);

    if (sincronizacionId) {
      await supabaseAdmin
        .from("sincronizaciones")
        .update({
          estado: "error",
          mensaje:
            error instanceof Error
              ? error.message
              : "Error desconocido",
          finalizado_en: new Date().toISOString(),
        })
        .eq("id", sincronizacionId);
    }

    return response.status(500).json({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "No fue posible sincronizar la cartola.",
    });
  }
}
