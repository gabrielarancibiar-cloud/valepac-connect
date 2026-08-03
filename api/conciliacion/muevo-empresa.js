import { supabaseAdmin } from "../_lib/supabaseAdmin.js";
import {
  consultarCopecFuel,
  obtenerSesionCopecFuel,
} from "../copecfuel/client.js";

const TAMANO_PAGINA = 1000;
const MAXIMO_PAGINAS_COPECFUEL = 100;
const RUT_COPEC = "995200007";
const FORMAS_PAGO = new Set([
  "EFECTIVO",
  "CREDITO",
  "DEBITO",
  "TARJETA DE CREDITO",
  "TARJETA DE DEBITO",
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

function normalizarRut(valor) {
  return String(valor || "")
    .replace(/[^0-9K]/gi, "")
    .toUpperCase();
}

function numero(valor) {
  const resultado = Number(valor);
  return Number.isFinite(resultado) ? resultado : 0;
}

function lista(valor) {
  return Array.isArray(valor) ? valor : [];
}

function normalizarFecha(valor) {
  const texto = String(valor || "").trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto;

  const coincidencia = texto.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return coincidencia
    ? `${coincidencia[3]}-${coincidencia[2]}-${coincidencia[1]}`
    : null;
}

function rangoMes(periodo) {
  const coincidencia = String(periodo || "").match(/^(\d{4})-(\d{2})$/);

  if (!coincidencia) return null;

  const anio = Number(coincidencia[1]);
  const mes = Number(coincidencia[2]);

  if (mes < 1 || mes > 12) return null;

  const diasMes = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const hoyChile = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const dias =
    periodo === hoyChile.slice(0, 7)
      ? Math.min(diasMes, Number(hoyChile.slice(8, 10)))
      : diasMes;
  const desde = `${periodo}-01`;
  const hasta = `${periodo}-${String(dias).padStart(2, "0")}`;
  const fechas = Array.from({ length: dias }, (_, indice) =>
    `${periodo}-${String(indice + 1).padStart(2, "0")}`
  );

  return { desde, hasta, fechas };
}

async function leerTabla(tabla, campos, desde, hasta) {
  const registros = [];
  let inicio = 0;

  while (true) {
    const { data, error } = await supabaseAdmin
      .from(tabla)
      .select(campos)
      .gte("fecha", desde)
      .lte("fecha", hasta)
      .order("fecha", { ascending: true })
      .range(inicio, inicio + TAMANO_PAGINA - 1);

    if (error) {
      throw new Error(`No se pudo leer ${tabla}: ${error.message}`);
    }

    const pagina = Array.isArray(data) ? data : [];
    registros.push(...pagina);

    if (pagina.length < TAMANO_PAGINA) break;
    inicio += TAMANO_PAGINA;
  }

  return registros;
}

function agruparPorFecha(registros) {
  return registros.reduce((grupos, registro) => {
    if (!grupos.has(registro.fecha)) grupos.set(registro.fecha, []);
    grupos.get(registro.fecha).push(registro);
    return grupos;
  }, new Map());
}

async function obtenerMes(periodo) {
  const rango = rangoMes(periodo);

  if (!rango) {
    const error = new Error("El periodo debe usar el formato AAAA-MM.");
    error.status = 400;
    throw error;
  }

  const [ventas, cargos] = await Promise.all([
    leerTabla(
      "muevo_empresa_ventas",
      "fecha, codigo_eds, transaccion_id, forma_pago, monto, datos_origen",
      rango.desde,
      rango.hasta
    ),
    leerTabla(
      "muevo_empresa_cargos",
      "fecha, codigo_eds, descripcion, referencia, monto",
      rango.desde,
      rango.hasta
    ),
  ]);
  const ventasPorFecha = agruparPorFecha(ventas);
  const cargosPorFecha = agruparPorFecha(cargos);
  const dias = rango.fechas.map((fecha) => {
    const ventasDia = ventasPorFecha.get(fecha) || [];
    const cargosDia = cargosPorFecha.get(fecha) || [];
    const montoVentas = ventasDia.reduce(
      (total, registro) => total + numero(registro.monto),
      0
    );
    const propinasVentas = ventasDia.reduce(
      (total, registro) =>
        total + numero(registro.datos_origen?.propina),
      0
    );
    const montoVentasBruto = ventasDia.reduce(
      (total, registro) =>
        total +
        numero(
          registro.datos_origen?.montoBruto ??
            numero(registro.monto) + numero(registro.datos_origen?.propina)
        ),
      0
    );
    const montoCargos = cargosDia.reduce(
      (total, registro) => total + numero(registro.monto),
      0
    );
    const diferencia = montoCargos - montoVentas;
    let estado = "diferencia";

    if (montoVentas === 0 && montoCargos === 0) estado = "sin_datos";
    else if (montoVentas === 0) estado = "sin_ventas";
    else if (montoCargos === 0) estado = "sin_cargos";
    else if (diferencia === 0) estado = "conciliado";

    const formasPago = ventasDia.reduce((grupos, venta) => {
      const nombre = normalizarTexto(venta.forma_pago);

      if (!grupos[nombre]) grupos[nombre] = { cantidad: 0, monto: 0 };
      grupos[nombre].cantidad += 1;
      grupos[nombre].monto += numero(venta.monto);
      return grupos;
    }, {});

    return {
      fecha,
      estado,
      ventas: {
        cantidad: ventasDia.length,
        montoBruto: montoVentasBruto,
        propinas: propinasVentas,
        monto: montoVentas,
        formasPago,
      },
      cargos: {
        cantidad: cargosDia.length,
        monto: montoCargos,
      },
      diferencia,
    };
  });
  const resumen = dias.reduce(
    (total, dia) => {
      total.diasConciliados += dia.estado === "conciliado" ? 1 : 0;
      total.diasConDiferencia += dia.estado === "diferencia" ? 1 : 0;
      total.diasPendientes +=
        ["sin_ventas", "sin_cargos"].includes(dia.estado) ? 1 : 0;
      total.cantidadVentas += dia.ventas.cantidad;
      total.montoVentasBruto += dia.ventas.montoBruto;
      total.descuentoPropinas += dia.ventas.propinas;
      total.montoVentas += dia.ventas.monto;
      total.cantidadCargos += dia.cargos.cantidad;
      total.montoCargos += dia.cargos.monto;
      total.diferencia += dia.diferencia;
      return total;
    },
    {
      diasConciliados: 0,
      diasConDiferencia: 0,
      diasPendientes: 0,
      cantidadVentas: 0,
      montoVentasBruto: 0,
      descuentoPropinas: 0,
      montoVentas: 0,
      cantidadCargos: 0,
      montoCargos: 0,
      diferencia: 0,
    }
  );

  return { rango: { desde: rango.desde, hasta: rango.hasta }, resumen, dias };
}

async function guardarVentas(filas, opciones = {}) {
  if (filas.length > 10000) {
    const error = new Error("La sincronizacion supera el maximo de 10.000 ventas.");
    error.status = 400;
    throw error;
  }

  const registros = new Map();

  for (const fila of filas) {
    const rutEmisor = normalizarRut(fila.rutEmisor);
    const formaPago = normalizarTexto(fila.formaPago);
    const fecha = normalizarFecha(fila.fecha);
    const transaccionId = String(fila.transaccionId || "").trim();
    const montoBruto = numero(fila.montoBruto ?? fila.monto);
    const propina = numero(fila.propina);
    const monto = Math.max(0, montoBruto - propina);

    if (
      rutEmisor !== RUT_COPEC ||
      !FORMAS_PAGO.has(formaPago) ||
      !fecha ||
      !transaccionId ||
      monto <= 0
    ) {
      continue;
    }

    const identificador = `muevo-venta-v1|${transaccionId}`;
    registros.set(identificador, {
      identificador_origen: identificador,
      fecha,
      codigo_eds: String(fila.codigoEds || "").trim() || null,
      transaccion_id: transaccionId,
      transaccion_codigo:
        String(fila.transaccionCodigo || "").trim() || null,
      rut_emisor: "99.520.000-7",
      razon_social_emisor:
        String(fila.razonSocialEmisor || "Copec S.A.").trim(),
      forma_pago: formaPago,
      tipo_documento: String(fila.tipoDocumento || "").trim() || null,
      descripcion_documento:
        String(fila.descripcionDocumento || "").trim() || null,
      folio: String(fila.folio || "").trim() || null,
      monto,
      datos_origen: {
        ...fila,
        montoBruto,
        propina,
        montoConciliable: monto,
      },
      sincronizado_en: new Date().toISOString(),
    });
  }

  const ventas = [...registros.values()];

  if (ventas.length === 0 && !opciones.permitirVacio) {
    const error = new Error(
      "No se encontraron ventas emitidas por Copec pagadas en efectivo, credito o debito."
    );
    error.status = 400;
    throw error;
  }

  if (opciones.reemplazarFecha) {
    let eliminacion = supabaseAdmin
      .from("muevo_empresa_ventas")
      .delete()
      .eq("fecha", opciones.reemplazarFecha);

    if (opciones.codigoEds) {
      eliminacion = eliminacion.eq("codigo_eds", opciones.codigoEds);
    }

    const { error: errorEliminacion } = await eliminacion;

    if (errorEliminacion) {
      throw new Error(
        `No se pudo reemplazar el detalle diario: ${errorEliminacion.message}`
      );
    }
  }

  if (ventas.length > 0) {
    const { error } = await supabaseAdmin
      .from("muevo_empresa_ventas")
      .upsert(ventas, { onConflict: "identificador_origen" });

    if (error) {
      throw new Error(`No se pudieron guardar las ventas: ${error.message}`);
    }
  }

  return {
    ventasRecibidas: filas.length,
    ventasGuardadas: ventas.length,
    montoBrutoGuardado: ventas.reduce(
      (total, venta) => total + numero(venta.datos_origen?.montoBruto),
      0
    ),
    totalPropinas: ventas.reduce(
      (total, venta) => total + numero(venta.datos_origen?.propina),
      0
    ),
    montoGuardado: ventas.reduce(
      (total, venta) => total + numero(venta.monto),
      0
    ),
  };
}

async function importarVentas(request) {
  const filas = Array.isArray(request.body?.ventas)
    ? request.body.ventas
    : [];

  if (filas.length === 0) {
    const error = new Error("El archivo no contiene ventas elegibles.");
    error.status = 400;
    throw error;
  }

  return guardarVentas(filas);
}

function seleccionarUbicacion(sesion, ubicacionSolicitada) {
  if (ubicacionSolicitada) {
    return sesion.ubicaciones.find(
      (ubicacion) =>
        ubicacion.ubicacionId === ubicacionSolicitada ||
        ubicacion.codigo === ubicacionSolicitada
    );
  }

  return (
    sesion.ubicaciones.find((ubicacion) => ubicacion.activa) ||
    sesion.ubicaciones[0]
  );
}

function adaptarVentaCopecFuel(fila, fecha, ubicacion) {
  return {
    transaccionId: fila.transaccionId,
    transaccionCodigo: fila.transaccionCodigo,
    codigoEds: ubicacion.codigo || null,
    fecha,
    rutEmisor: fila.clienteRut,
    razonSocialEmisor: fila.clienteRazonSocial,
    formaPago: fila.formaPagoNombre || fila.formaPago,
    tipoDocumento: fila.tipoDocumento,
    descripcionDocumento: fila.descripcionDocumento,
    folio: fila.folio,
    montoBruto: numero(
      fila.totalMontoPagar ??
        fila.totalMontoPagarManual ??
        fila.totalMontoPago ??
        fila.total
    ),
    propina: numero(fila.totalPropina),
    fuente: "copecfuel_api",
    datosCopecFuel: fila,
  };
}

async function sincronizarVentasCopecFuel(request) {
  const fecha = normalizarFecha(request.body?.fecha || request.query?.fecha);

  if (!fecha) {
    const error = new Error("La fecha debe usar el formato AAAA-MM-DD.");
    error.status = 400;
    throw error;
  }

  const sesion = await obtenerSesionCopecFuel();

  if (sesion.requiereCodigoEquipo || !sesion.maquinaActiva) {
    const error = new Error(
      "CopecFuel requiere validar el equipo antes de sincronizar."
    );
    error.requiereCodigoEquipo = true;
    throw error;
  }

  const ubicacion = seleccionarUbicacion(
    sesion,
    String(request.body?.ubicacionId || request.query?.ubicacionId || "")
  );

  if (!ubicacion?.ubicacionId) {
    throw new Error("No se encontro una estacion disponible en CopecFuel.");
  }

  const filasDetalle = [];
  const clavesVisitadas = new Set();
  let ultimaClave = null;
  let paginasConsultadas = 0;

  do {
    const params = new URLSearchParams({
      cuentaId: sesion.cuentaId,
      clienteId: sesion.clienteId,
      turnoId: fecha.replace(/-/g, ""),
      ubicacionId: ubicacion.ubicacionId,
      tipoReporte: "EXCEL_VENTA",
    });

    if (ultimaClave) {
      params.set("last_evaluated_key", ultimaClave);
    }

    const payload = await consultarCopecFuel(
      `WEBRPT1/reportedias?${params.toString()}`,
      sesion
    );
    const data = payload?.data;

    if (!data || !Array.isArray(data.reporteExcel)) {
      throw new Error(
        "CopecFuel no entrego el detalle de ventas esperado."
      );
    }

    filasDetalle.push(...lista(data.reporteExcel));
    paginasConsultadas += 1;

    const nuevaClave = data.last_evaluated_key
      ? String(data.last_evaluated_key)
      : "";

    if (!nuevaClave) {
      ultimaClave = null;
    } else if (clavesVisitadas.has(nuevaClave)) {
      throw new Error("CopecFuel repitio una pagina del reporte de ventas.");
    } else {
      clavesVisitadas.add(nuevaClave);
      ultimaClave = nuevaClave;
    }

    if (paginasConsultadas >= MAXIMO_PAGINAS_COPECFUEL && ultimaClave) {
      throw new Error("El reporte CopecFuel supero el limite de paginacion.");
    }
  } while (ultimaClave);

  const filas = filasDetalle.map((fila) =>
    adaptarVentaCopecFuel(fila, fecha, ubicacion)
  );
  const resultado = await guardarVentas(filas, {
    reemplazarFecha: fecha,
    codigoEds: ubicacion.codigo || null,
    permitirVacio: true,
  });

  return {
    fecha,
    estacion: ubicacion.codigo || ubicacion.ubicacionId,
    paginasConsultadas,
    registrosDetalle: filasDetalle.length,
    ...resultado,
  };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "private, no-store");

  try {
    if (request.method === "GET") {
      const periodo = String(request.query.periodo || "").trim();
      const resultado = await obtenerMes(periodo);

      return response.status(200).json({
        ok: true,
        conciliador: "Cargos Muevo empresa",
        periodo,
        ...resultado,
        criterio:
          "Cargos Consumo Muevo Empresa del Portal Copec menos ventas emitidas por Copec pagadas en efectivo, credito o debito, descontando sus propinas.",
      });
    }

    if (request.method === "POST") {
      if (request.body?.accion === "sincronizar_copecfuel") {
        const resultado = await sincronizarVentasCopecFuel(request);

        return response.status(200).json({
          ok: true,
          mensaje: "Ventas Muevo Empresa sincronizadas desde CopecFuel.",
          ...resultado,
        });
      }

      const resultado = await importarVentas(request);

      return response.status(200).json({
        ok: true,
        mensaje: "Detalle de ventas Muevo Empresa importado correctamente.",
        ...resultado,
      });
    }

    return response.status(405).json({
      ok: false,
      error: "Metodo no permitido.",
    });
  } catch (error) {
    console.error("Error en Cargos Muevo empresa:", error);

    return response.status(error?.status || 500).json({
      ok: false,
      requiereCodigoEquipo: Boolean(error?.requiereCodigoEquipo),
      error:
        error instanceof Error
          ? error.message
          : "No fue posible procesar Cargos Muevo empresa.",
    });
  }
}
