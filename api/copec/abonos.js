import { supabaseAdmin } from "../_lib/supabaseAdmin.js";

const TAMANO_PAGINA_RESUMEN = 1000;
const LIMITE_MAXIMO_TABLA = 200;

function obtenerLimite(valor) {
  const numero = Number.parseInt(valor, 10);

  if (!Number.isFinite(numero)) {
    return 100;
  }

  return Math.min(Math.max(numero, 1), LIMITE_MAXIMO_TABLA);
}

async function obtenerUltimaSincronizacion() {
  const { data, error } = await supabaseAdmin
    .from("sincronizaciones")
    .select(
      "id, periodo, estado, registros_encontrados, registros_guardados, mensaje, iniciado_en, finalizado_en"
    )
    .eq("integracion", "copec")
    .eq("estado", "completado")
    .order("finalizado_en", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(
      `No se pudo obtener la última sincronización: ${error.message}`
    );
  }

  return data;
}

async function obtenerPeriodoDisponible() {
  const { data, error } = await supabaseAdmin
    .from("copec_movimientos")
    .select("periodo")
    .not("periodo", "is", null)
    .order("sincronizado_en", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`No se pudo determinar el período: ${error.message}`);
  }

  return data?.periodo || null;
}

async function obtenerResumen(periodo) {
  const { count, error: errorConteo } = await supabaseAdmin
    .from("copec_movimientos")
    .select("id", { count: "exact", head: true })
    .eq("periodo", periodo);

  if (errorConteo) {
    throw new Error(`No se pudieron contar los abonos: ${errorConteo.message}`);
  }

  const cantidadAbonos = count || 0;
  let totalAbonos = 0;

  for (
    let desde = 0;
    desde < cantidadAbonos;
    desde += TAMANO_PAGINA_RESUMEN
  ) {
    const hasta = Math.min(
      desde + TAMANO_PAGINA_RESUMEN - 1,
      cantidadAbonos - 1
    );

    const { data, error } = await supabaseAdmin
      .from("copec_movimientos")
      .select("monto")
      .eq("periodo", periodo)
      .range(desde, hasta);

    if (error) {
      throw new Error(`No se pudo calcular el total: ${error.message}`);
    }

    totalAbonos += (data || []).reduce(
      (total, movimiento) => total + Number(movimiento.monto || 0),
      0
    );
  }

  return { cantidadAbonos, totalAbonos };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "private, no-store");

  if (request.method !== "GET") {
    return response.status(405).json({
      ok: false,
      error: "Método no permitido. Usa GET.",
    });
  }

  try {
    const ultimaSincronizacion = await obtenerUltimaSincronizacion();
    const periodoSolicitado =
      typeof request.query.periodo === "string"
        ? request.query.periodo.trim()
        : "";
    const periodo =
      periodoSolicitado ||
      ultimaSincronizacion?.periodo ||
      (await obtenerPeriodoDisponible());

    if (!periodo) {
      return response.status(200).json({
        ok: true,
        conectado: true,
        resumen: {
          periodo: null,
          cantidadAbonos: 0,
          totalAbonos: 0,
          ultimoMovimiento: null,
          ultimaSincronizacion: ultimaSincronizacion?.finalizado_en || null,
        },
        abonos: [],
      });
    }

    const limite = obtenerLimite(request.query.limite);
    const [resumen, movimientosResultado] = await Promise.all([
      obtenerResumen(periodo),
      supabaseAdmin
        .from("copec_movimientos")
        .select(
          "id, fecha_movimiento, fecha_contable, descripcion, referencia, tipo_movimiento, monto, saldo, periodo, id_eds, sincronizado_en"
        )
        .eq("periodo", periodo)
        .order("fecha_movimiento", {
          ascending: false,
          nullsFirst: false,
        })
        .order("sincronizado_en", { ascending: false })
        .limit(limite),
    ]);

    if (movimientosResultado.error) {
      throw new Error(
        `No se pudieron obtener los abonos: ${movimientosResultado.error.message}`
      );
    }

    const abonos = movimientosResultado.data || [];

    return response.status(200).json({
      ok: true,
      conectado: true,
      resumen: {
        periodo,
        cantidadAbonos: resumen.cantidadAbonos,
        totalAbonos: resumen.totalAbonos,
        ultimoMovimiento: abonos[0]?.fecha_movimiento || null,
        ultimaSincronizacion: ultimaSincronizacion?.finalizado_en || null,
      },
      sincronizacion: ultimaSincronizacion,
      abonos,
      limite,
      fechaConsulta: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error leyendo abonos Copec:", error);

    return response.status(500).json({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "No fue posible obtener los abonos de Copec.",
    });
  }
}
