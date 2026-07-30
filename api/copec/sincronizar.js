import { supabaseAdmin } from "../_lib/supabaseAdmin.js";

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

function crearIdentificador(movimiento, indice, periodo) {
  if (movimiento.ID) {
    return String(movimiento.ID);
  }

  const partes = [
    periodo,
    movimiento.FECHA_MOVIMIENTO,
    movimiento.NUMERO_DOCUMENTO,
    movimiento.NUMERO_OFICINA,
    movimiento.ABONO,
    movimiento.CARGO,
    indice,
  ];

  return partes.map((valor) => String(valor ?? "")).join("|");
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    return response.status(405).json({
      ok: false,
      error: "Método no permitido. Usa POST.",
    });
  }

  const token = process.env.COPEC_TOKEN;
  const rutConcesionario = process.env.COPEC_RUT_CONCESIONARIO;
  const idEds = process.env.COPEC_ID_EDS || "*";

  if (!token || !rutConcesionario) {
    return response.status(500).json({
      ok: false,
      error: "Faltan las variables privadas de Copec en Vercel.",
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

    const copecResponse = await fetch(
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

    const texto = await copecResponse.text();

    let payload;

    try {
      payload = JSON.parse(texto);
    } catch {
      throw new Error("Copec respondió con un formato no válido.");
    }

    if (!copecResponse.ok) {
      throw new Error(
        `Copec rechazó la consulta con estado ${copecResponse.status}.`
      );
    }

    const datos = payload?.data ?? {};
    const movimientos = Array.isArray(datos.MOVIMIENTOS)
      ? datos.MOVIMIENTOS
      : [];

    const periodoRespuesta =
      datos.PERIODO || periodo || "sin-periodo";

    const abonos = movimientos.filter(
      (movimiento) => convertirNumero(movimiento.ABONO) > 0
    );

    const registros = abonos.map((movimiento, indice) => ({
      identificador_origen: crearIdentificador(
        movimiento,
        indice,
        periodoRespuesta
      ),
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
    }));

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
      registrosGuardados,
      totalAbonos,
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
