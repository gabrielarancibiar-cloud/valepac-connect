import { requireAdmin, supabaseAdmin } from "../_lib/supabaseAdmin.js";

const TAMANO_PAGINA = 1000;

const DESCRIPCIONES_ABONOS = [
  "Venta App Copec Banco Estado (Propina)",
  "Venta App Copec Banco Estado",
  "Venta App Copec Pay (Propina)",
  "Venta App Copec Pay",
  "Venta App Copec Transbank (Propina)",
  "Venta App Copec Transbank",
  "Venta App Banco Estado",
  "Venta App Copec BPE",
  "Venta Adquirente KUSHKI (Propina)",
  "Venta Adquirente KUSHKI",
  "Venta Adquirente KLAP (Propina)",
  "Venta Adquirente KLAP",
  "Venta App Copec Sin Autorizador",
  "Venta App Copec BPE (Propina)",
];

const FORMAS_PAGO_CONCILIABLES = new Set([
  "DEBITO",
  "CREDITO",
  "APP COPEC",
  "RUTPAY",
  "RUT PAY",
  "BILLETERA BANCO ESTADO",
]);

function normalizarTexto(valor) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^0-9A-Z]+/gi, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

const DESCRIPCIONES_NORMALIZADAS = new Set(
  DESCRIPCIONES_ABONOS.map(normalizarTexto)
);

function numero(valor) {
  const resultado = Number(valor);
  return Number.isFinite(resultado) ? resultado : 0;
}

function obtenerFechaChile() {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const valores = Object.fromEntries(
    partes
      .filter((parte) => parte.type !== "literal")
      .map((parte) => [parte.type, parte.value])
  );

  return `${valores.year}-${valores.month}-${valores.day}`;
}

function obtenerRangoMes(periodo) {
  const coincidencia = String(periodo || "").match(/^(\d{4})-(\d{2})$/);

  if (!coincidencia) return null;

  const anio = Number(coincidencia[1]);
  const mes = Number(coincidencia[2]);

  if (mes < 1 || mes > 12) return null;

  const cantidadDias = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const desde = `${anio}-${String(mes).padStart(2, "0")}-01`;
  const finMes = `${anio}-${String(mes).padStart(2, "0")}-${String(
    cantidadDias
  ).padStart(2, "0")}`;
  const hoy = obtenerFechaChile();

  if (desde > hoy) {
    return { desde, hasta: finMes, fechas: [] };
  }

  const hasta = finMes > hoy ? hoy : finMes;
  const ultimoDia = Number(hasta.slice(-2));
  const fechas = Array.from({ length: ultimoDia }, (_, indice) =>
    `${periodo}-${String(indice + 1).padStart(2, "0")}`
  );

  return { desde, hasta, fechas };
}

function descripcionAbono(movimiento) {
  const datos = movimiento?.datos_origen || {};
  const candidatos = [
    movimiento?.descripcion,
    datos.DESCRIPCION,
    datos.descripcion,
    datos.CLASIFICACION,
    datos.clasificacion,
    datos.LINEA_PRODUCTO,
    datos.lineaProducto,
    datos.GLOSA,
    datos.glosa,
    ...Object.values(datos),
  ];

  for (const candidato of candidatos) {
    if (
      ["string", "number"].includes(typeof candidato) &&
      DESCRIPCIONES_NORMALIZADAS.has(normalizarTexto(candidato))
    ) {
      return String(candidato);
    }
  }

  return movimiento?.descripcion || "Sin identificar";
}

function esAbonoConciliable(movimiento) {
  return DESCRIPCIONES_NORMALIZADAS.has(
    normalizarTexto(descripcionAbono(movimiento))
  );
}

function esFormaPagoConciliable(nombre) {
  return FORMAS_PAGO_CONCILIABLES.has(normalizarTexto(nombre));
}

function textoClave(valor) {
  return String(valor ?? "").trim();
}

function montoClave(valor) {
  return numero(valor).toFixed(2);
}

function claveNegocioAbono(movimiento) {
  const datos = movimiento?.datos_origen || {};

  return [
    "copec-v3",
    textoClave(movimiento?.fecha_movimiento || datos.FECHA_MOVIMIENTO),
    textoClave(
      movimiento?.referencia ||
        datos.NUMERO_DOCUMENTO ||
        datos.FACTURA_SD
    ),
    textoClave(
      movimiento?.id_eds || datos.NUMERO_EDS || datos.NUMERO_OFICINA
    ),
    textoClave(
      movimiento?.tipo_movimiento || datos.TIPO_DOCUMENTO || "ABONO"
    ),
    montoClave(movimiento?.monto ?? datos.ABONO),
  ].join("|");
}

function obtenerMovimientosUnicos(movimientos) {
  const unicos = new Map();

  for (const movimiento of movimientos) {
    unicos.set(claveNegocioAbono(movimiento), movimiento);
  }

  return [...unicos.values()];
}

function claveFormaPago(nombre) {
  const valor = normalizarTexto(nombre);

  if (["RUTPAY", "RUT PAY", "BILLETERA BANCO ESTADO"].includes(valor)) {
    return "RUTPAY";
  }

  if (["APP COPEC", "DEBITO", "CREDITO"].includes(valor)) {
    return valor.replace(" ", "_");
  }

  return null;
}

async function leerAbonos(desde, hasta) {
  const movimientos = [];
  let inicio = 0;

  while (true) {
    const { data, error } = await supabaseAdmin
      .from("copec_movimientos")
      .select(
        "id, fecha_movimiento, descripcion, referencia, tipo_movimiento, monto, id_eds, datos_origen"
      )
      .gte("fecha_movimiento", desde)
      .lte("fecha_movimiento", hasta)
      .order("fecha_movimiento", { ascending: true })
      .range(inicio, inicio + TAMANO_PAGINA - 1);

    if (error) {
      throw new Error(`No se pudieron leer los abonos: ${error.message}`);
    }

    const pagina = Array.isArray(data) ? data : [];
    movimientos.push(...pagina);

    if (pagina.length < TAMANO_PAGINA) break;
    inicio += TAMANO_PAGINA;
  }

  return movimientos;
}

function calcularDia(fecha, resumenVentas, formasPago, movimientos) {
  const formasConciliables = formasPago.filter((forma) =>
    esFormaPagoConciliable(forma.nombre)
  );
  const desglose = {
    APP_COPEC: { cantidad: 0, monto: 0 },
    DEBITO: { cantidad: 0, monto: 0 },
    CREDITO: { cantidad: 0, monto: 0 },
    RUTPAY: { cantidad: 0, monto: 0 },
  };

  for (const forma of formasConciliables) {
    const clave = claveFormaPago(forma.nombre);

    if (clave && desglose[clave]) {
      desglose[clave].cantidad += numero(forma.numero_ventas);
      desglose[clave].monto += numero(forma.monto);
    }
  }

  const cantidadVentas = formasConciliables.reduce(
    (total, forma) => total + numero(forma.numero_ventas),
    0
  );
  const totalVentas = formasConciliables.reduce(
    (total, forma) => total + numero(forma.monto),
    0
  );
  const propinasInformadas = formasConciliables.reduce(
    (total, forma) => total + numero(forma?.datos_origen?.propina),
    0
  );
  const vueltosOrigen = Array.isArray(
    resumenVentas?.datos_origen?.vueltosFormasPago
  )
    ? resumenVentas.datos_origen.vueltosFormasPago
    : [];
  const totalVueltos = vueltosOrigen
    .filter((vuelto) =>
      esFormaPagoConciliable(vuelto?.formadePago || vuelto?.formaDePago)
    )
    .reduce((total, vuelto) => total + numero(vuelto?.monto), 0);

  const abonosAntesDeDepurar = movimientos.filter(esAbonoConciliable);
  const abonosConciliables = obtenerMovimientosUnicos(
    abonosAntesDeDepurar
  );
  const duplicadosIgnorados =
    abonosAntesDeDepurar.length - abonosConciliables.length;
  const totalAbonos = abonosConciliables.reduce(
    (total, movimiento) => total + numero(movimiento.monto),
    0
  );
  const abonosPropina = abonosConciliables.filter((movimiento) =>
    normalizarTexto(descripcionAbono(movimiento)).includes("PROPINA")
  );
  const totalPropinas = abonosPropina.reduce(
    (total, movimiento) => total + numero(movimiento.monto),
    0
  );
  const totalAbonosConciliable = totalAbonos - totalPropinas - totalVueltos;
  const diferencia = totalAbonosConciliable - totalVentas;
  let estado = "diferencia";

  if (totalVentas === 0 && totalAbonos === 0) estado = "sin_datos";
  else if (totalVentas === 0) estado = "sin_ventas";
  else if (totalAbonos === 0) estado = "sin_abonos";
  else if (diferencia === 0) estado = "conciliado";

  return {
    fecha,
    estado,
    estacion: resumenVentas?.codigo_eds || null,
    copecFuel: {
      sincronizado: Boolean(resumenVentas),
      cantidadVentas,
      montoConciliable: totalVentas,
      montoTotal: numero(resumenVentas?.monto_total),
      propinasInformadas,
      formasPago: desglose,
      sincronizadoEn: resumenVentas?.sincronizado_en || null,
    },
    portalCopec: {
      cantidadAbonos: abonosConciliables.length,
      duplicadosIgnorados,
      montoBruto: totalAbonos,
      descuentoPropinas: totalPropinas,
      descuentoVueltos: totalVueltos,
      montoConciliable: totalAbonosConciliable,
    },
    diferencia,
  };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "private, no-store");

  if (!(await requireAdmin(request, response))) return;

  if (request.method !== "GET") {
    return response.status(405).json({
      ok: false,
      error: "Metodo no permitido. Usa GET.",
    });
  }

  try {
    const periodo = String(request.query.periodo || "").trim();
    const rango = obtenerRangoMes(periodo);

    if (!rango) {
      return response.status(400).json({
        ok: false,
        error: "El periodo debe usar el formato AAAA-MM.",
      });
    }

    if (rango.fechas.length === 0) {
      return response.status(200).json({
        ok: true,
        periodo,
        rango,
        resumen: {
          diasPeriodo: 0,
          diasConVentas: 0,
          diasConciliados: 0,
          diasConDiferencia: 0,
          diasPendientes: 0,
          cantidadVentas: 0,
          montoVentas: 0,
          montoAbonosConciliable: 0,
          diferencia: 0,
          ultimaSincronizacion: null,
        },
        dias: [],
      });
    }

    const [resultadoResumenes, movimientos] = await Promise.all([
      supabaseAdmin
        .from("copecfuel_resumenes")
        .select(
          "id, codigo_eds, fecha_desde, fecha_hasta, cantidad_transacciones, monto_total, datos_origen, sincronizado_en"
        )
        .gte("fecha_desde", rango.desde)
        .lte("fecha_desde", rango.hasta)
        .order("sincronizado_en", { ascending: false }),
      leerAbonos(rango.desde, rango.hasta),
    ]);

    if (resultadoResumenes.error) {
      throw new Error(
        `No se pudieron leer las ventas CopecFuel: ${resultadoResumenes.error.message}`
      );
    }

    const resumenesDiarios = (resultadoResumenes.data || []).filter(
      (resumen) => resumen.fecha_desde === resumen.fecha_hasta
    );
    const resumenPorFecha = new Map();

    for (const resumen of resumenesDiarios) {
      if (!resumenPorFecha.has(resumen.fecha_desde)) {
        resumenPorFecha.set(resumen.fecha_desde, resumen);
      }
    }

    const idsResumen = [...resumenPorFecha.values()].map((resumen) => resumen.id);
    let formasPago = [];

    if (idsResumen.length > 0) {
      const { data, error } = await supabaseAdmin
        .from("copecfuel_formas_pago")
        .select("resumen_id, nombre, numero_ventas, monto, datos_origen")
        .in("resumen_id", idsResumen);

      if (error) {
        throw new Error(`No se pudieron leer los medios de pago: ${error.message}`);
      }

      formasPago = data || [];
    }

    const formasPorResumen = formasPago.reduce((grupos, forma) => {
      if (!grupos.has(forma.resumen_id)) grupos.set(forma.resumen_id, []);
      grupos.get(forma.resumen_id).push(forma);
      return grupos;
    }, new Map());
    const abonosPorFecha = movimientos.reduce((grupos, movimiento) => {
      const fecha = movimiento.fecha_movimiento;
      if (!grupos.has(fecha)) grupos.set(fecha, []);
      grupos.get(fecha).push(movimiento);
      return grupos;
    }, new Map());

    const dias = rango.fechas.map((fecha) => {
      const resumenVentas = resumenPorFecha.get(fecha) || null;
      return calcularDia(
        fecha,
        resumenVentas,
        resumenVentas ? formasPorResumen.get(resumenVentas.id) || [] : [],
        abonosPorFecha.get(fecha) || []
      );
    });
    const resumen = dias.reduce(
      (total, dia) => {
        total.diasConVentas += dia.copecFuel.sincronizado ? 1 : 0;
        total.diasConciliados += dia.estado === "conciliado" ? 1 : 0;
        total.diasConDiferencia += dia.estado === "diferencia" ? 1 : 0;
        total.diasPendientes += dia.estado !== "conciliado" ? 1 : 0;
        total.cantidadVentas += dia.copecFuel.cantidadVentas;
        total.montoVentas += dia.copecFuel.montoConciliable;
        total.montoAbonosConciliable += dia.portalCopec.montoConciliable;
        total.diferencia += dia.diferencia;

        if (
          dia.copecFuel.sincronizadoEn &&
          (!total.ultimaSincronizacion ||
            dia.copecFuel.sincronizadoEn > total.ultimaSincronizacion)
        ) {
          total.ultimaSincronizacion = dia.copecFuel.sincronizadoEn;
        }

        return total;
      },
      {
        diasPeriodo: dias.length,
        diasConVentas: 0,
        diasConciliados: 0,
        diasConDiferencia: 0,
        diasPendientes: 0,
        cantidadVentas: 0,
        montoVentas: 0,
        montoAbonosConciliable: 0,
        diferencia: 0,
        ultimaSincronizacion: null,
      }
    );

    return response.status(200).json({
      ok: true,
      periodo,
      rango: { desde: rango.desde, hasta: rango.hasta },
      resumen,
      dias,
      criterio:
        "Abonos conciliables = abonos Portal Copec - propinas - vueltos. La diferencia compara ese resultado con APP COPEC, DEBITO, CREDITO y RUTPAY/BILLETERA BANCO ESTADO.",
      fechaConsulta: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error calculando conciliacion mensual:", error);

    return response.status(500).json({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "No fue posible calcular la conciliacion mensual.",
    });
  }
}
