import { supabaseAdmin } from "../_lib/supabaseAdmin.js";

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

const FORMAS_PAGO_CONCILIABLES = new Set([
  "DEBITO",
  "CREDITO",
  "APP COPEC",
  "RUTPAY",
  "RUT PAY",
  "BILLETERA BANCO ESTADO",
]);

function normalizarFecha(valor) {
  const coincidencia = String(valor || "").match(
    /^(\d{4})-?(\d{2})-?(\d{2})$/
  );

  return coincidencia
    ? `${coincidencia[1]}-${coincidencia[2]}-${coincidencia[3]}`
    : null;
}

function numero(valor) {
  const resultado = Number(valor);
  return Number.isFinite(resultado) ? resultado : 0;
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

async function leerAbonos(desde, hasta) {
  const movimientos = [];
  const tamanoPagina = 1000;
  let inicio = 0;

  while (true) {
    const { data, error } = await supabaseAdmin
      .from("copec_movimientos")
      .select(
        "id, fecha_movimiento, descripcion, referencia, monto, datos_origen"
      )
      .gte("fecha_movimiento", desde)
      .lte("fecha_movimiento", hasta)
      .order("fecha_movimiento", { ascending: true })
      .range(inicio, inicio + tamanoPagina - 1);

    if (error) {
      throw new Error(`No se pudieron leer los abonos: ${error.message}`);
    }

    const pagina = Array.isArray(data) ? data : [];
    movimientos.push(...pagina);

    if (pagina.length < tamanoPagina) {
      break;
    }

    inicio += tamanoPagina;
  }

  return movimientos;
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");

  if (request.method !== "GET") {
    return response.status(405).json({
      ok: false,
      error: "Metodo no permitido. Usa GET.",
    });
  }

  try {
    const ventasDesde = normalizarFecha(request.query.ventasDesde);
    const ventasHasta = normalizarFecha(
      request.query.ventasHasta || request.query.ventasDesde
    );
    const abonosDesde = normalizarFecha(
      request.query.abonosDesde || request.query.ventasDesde
    );
    const abonosHasta = normalizarFecha(
      request.query.abonosHasta ||
        request.query.abonosDesde ||
        request.query.ventasHasta ||
        request.query.ventasDesde
    );

    if (!ventasDesde || !ventasHasta || !abonosDesde || !abonosHasta) {
      return response.status(400).json({
        ok: false,
        error:
          "Debes indicar ventasDesde y opcionalmente ventasHasta, abonosDesde y abonosHasta.",
      });
    }

    const { data: resumenVentas, error: errorResumen } = await supabaseAdmin
      .from("copecfuel_resumenes")
      .select(
        "id, codigo_eds, fecha_desde, fecha_hasta, cantidad_transacciones, monto_total, datos_origen, sincronizado_en"
      )
      .eq("fecha_desde", ventasDesde)
      .eq("fecha_hasta", ventasHasta)
      .order("sincronizado_en", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (errorResumen) {
      throw new Error(
        `No se pudo leer el resumen CopecFuel: ${errorResumen.message}`
      );
    }

    if (!resumenVentas) {
      return response.status(404).json({
        ok: false,
        error:
          "No existe una sincronizacion CopecFuel para ese rango de ventas.",
        sincronizarPrimero: `/api/copecfuel/sincronizar?desde=${ventasDesde}&hasta=${ventasHasta}`,
      });
    }

    const { data: formasPago, error: errorFormas } = await supabaseAdmin
      .from("copecfuel_formas_pago")
      .select(
        "nombre, numero_ventas, monto, incluir_conciliacion, datos_origen"
      )
      .eq("resumen_id", resumenVentas.id)
      .order("nombre", { ascending: true });

    if (errorFormas) {
      throw new Error(
        `No se pudieron leer las ventas conciliables: ${errorFormas.message}`
      );
    }

    const todasLasFormasPago = Array.isArray(formasPago) ? formasPago : [];
    const ventasConciliables = todasLasFormasPago.filter((forma) =>
      esFormaPagoConciliable(forma.nombre)
    );
    const totalVentasBruto = ventasConciliables.reduce(
      (total, forma) => total + numero(forma.monto),
      0
    );
    const cantidadVentas = ventasConciliables.reduce(
      (total, forma) => total + numero(forma.numero_ventas),
      0
    );
    const propinasVentas = ventasConciliables.reduce(
      (total, forma) => total + numero(forma?.datos_origen?.propina),
      0
    );
    const vueltosOrigen = Array.isArray(
      resumenVentas?.datos_origen?.vueltosFormasPago
    )
      ? resumenVentas.datos_origen.vueltosFormasPago
      : [];
    const vueltosConciliables = vueltosOrigen.filter((vuelto) =>
      esFormaPagoConciliable(
        vuelto?.formadePago || vuelto?.formaDePago
      )
    );
    const totalVueltos = vueltosConciliables.reduce(
      (total, vuelto) => total + numero(vuelto?.monto),
      0
    );
    const totalVentas = totalVentasBruto;
    const totalPagoInformado = ventasConciliables.reduce(
      (total, forma) => total + numero(forma?.datos_origen?.totalPago),
      0
    );
    const totalDocumentoInformado = ventasConciliables.reduce(
      (total, forma) =>
        total + numero(forma?.datos_origen?.totalDocumento),
      0
    );

    const movimientos = await leerAbonos(abonosDesde, abonosHasta);
    const abonosConciliables = movimientos.filter(esAbonoConciliable);
    const totalAbonos = abonosConciliables.reduce(
      (total, movimiento) => total + numero(movimiento.monto),
      0
    );
    const abonosPropina = abonosConciliables.filter((movimiento) =>
      normalizarTexto(descripcionAbono(movimiento)).includes("PROPINA")
    );
    const totalAbonosPropina = abonosPropina.reduce(
      (total, movimiento) => total + numero(movimiento.monto),
      0
    );
    const totalAbonosSinPropina = totalAbonos - totalAbonosPropina;
    const totalAbonosConciliable =
      totalAbonos - totalAbonosPropina - totalVueltos;
    const diferencia = totalAbonosConciliable - totalVentas;
    let estado = "diferencia";

    if (totalVentas === 0 && totalAbonos === 0) {
      estado = "sin_datos";
    } else if (totalVentas === 0) {
      estado = "sin_ventas";
    } else if (totalAbonos === 0) {
      estado = "sin_abonos";
    } else if (diferencia === 0) {
      estado = "conciliado";
    }
    const detalleAbonos = Object.values(
      abonosConciliables.reduce((grupos, movimiento) => {
        const descripcion = descripcionAbono(movimiento);
        const clave = normalizarTexto(descripcion);

        if (!grupos[clave]) {
          grupos[clave] = {
            descripcion,
            cantidad: 0,
            monto: 0,
          };
        }

        grupos[clave].cantidad += 1;
        grupos[clave].monto += numero(movimiento.monto);
        return grupos;
      }, {})
    ).sort((a, b) => a.descripcion.localeCompare(b.descripcion));

    return response.status(200).json({
      ok: true,
      estado,
      estacion: resumenVentas.codigo_eds,
      periodos: {
        ventas: { desde: ventasDesde, hasta: ventasHasta },
        abonos: { desde: abonosDesde, hasta: abonosHasta },
      },
      ventasCopecFuel: {
        cantidad: cantidadVentas,
        monto: totalVentas,
        montoBruto: totalVentasBruto,
        formasPago: ventasConciliables.map((forma) => ({
          nombre: forma.nombre,
          numeroVentas: numero(forma.numero_ventas),
          monto: numero(forma.monto),
          propina: numero(forma?.datos_origen?.propina),
          totalDocumento: numero(forma?.datos_origen?.totalDocumento),
          totalPago: numero(forma?.datos_origen?.totalPago),
          ajuste: numero(forma?.datos_origen?.ajuste),
          descuentos: numero(forma?.datos_origen?.totalDescuento),
        })),
        formasPagoRevisadas: todasLasFormasPago.length,
        propinasInformadas: propinasVentas,
        totalPagoInformado,
        totalDocumentoInformado,
        vueltos: vueltosConciliables.map((vuelto) => ({
          formaPago: vuelto?.formadePago || vuelto?.formaDePago || null,
          monto: numero(vuelto?.monto),
        })),
      },
      abonosPortalCopec: {
        cantidad: abonosConciliables.length,
        monto: totalAbonos,
        montoBruto: totalAbonos,
        cantidadPropinas: abonosPropina.length,
        descuentoPropinas: totalAbonosPropina,
        descuentoVueltos: totalVueltos,
        montoConciliable: totalAbonosConciliable,
        descripciones: detalleAbonos,
        movimientosRevisados: movimientos.length,
      },
      diferencia,
      diagnostico: {
        diferenciaAplicandoReglas: diferencia,
        diferenciaExcluyendoPropinas:
          totalAbonosSinPropina - totalVentas,
        diferenciaAntesDeDescuentos:
          totalAbonos - totalVentasBruto,
        diferenciaUsandoTotalPago:
          totalPagoInformado > 0 ? totalAbonos - totalPagoInformado : null,
        diferenciaUsandoTotalDocumento:
          totalDocumentoInformado > 0
            ? totalAbonos - totalDocumentoInformado
            : null,
      },
      criterio:
        "Diferencia = (abonos Portal Copec - propinas - vueltos) menos ventas conciliables CopecFuel.",
      fechaConsulta: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error calculando conciliacion:", error);

    return response.status(500).json({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "No fue posible calcular la conciliacion.",
    });
  }
}
