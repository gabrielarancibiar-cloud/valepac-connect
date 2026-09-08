import { supabaseAdmin } from "../../api/_lib/supabaseAdmin.js";

const CANALES = [
  "VENTA_PROPIA_ISLA",
  "VENTA_PROPIA_CAMION",
  "CUPON",
  "FFAA",
  "CUENTA_EMPRESA",
  "TCT",
  "TAE",
];

const COMBUSTIBLES = ["DSL", "G93", "G97"];

function texto(valor) {
  return valor === null || valor === undefined ? "" : String(valor).trim();
}

function numero(valor) {
  const resultado = Number(valor);
  return Number.isFinite(resultado) ? resultado : 0;
}

function redondearLitros(valor) {
  return Math.round((numero(valor) + Number.EPSILON) * 1000) / 1000;
}

function normalizar(valor) {
  return texto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^0-9A-Z]+/gi, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function normalizarFecha(valor) {
  const fecha = texto(valor);
  if (/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return fecha;

  const coincidencia = fecha.match(/^(\d{2})-(\d{2})-(\d{4})(?:\s|$)/);
  return coincidencia
    ? `${coincidencia[3]}-${coincidencia[2]}-${coincidencia[1]}`
    : null;
}

function numeroChile(valor) {
  if (typeof valor === "number") return numero(valor);

  const limpio = texto(valor).replace(/\./g, "").replace(",", ".");
  return numero(limpio);
}

export function clasificarMedioPagoPoa(valor) {
  const formaPago = normalizar(valor);

  if (
    ["APP COPEC EMPRESA", "MUEVO EMPRESA", "MUEVO EMPRESAS"].includes(
      formaPago
    )
  ) {
    return "CUENTA_EMPRESA";
  }

  if (formaPago === "CUPON ELECTRONICO") return "CUPON";

  if (
    ["TARJETA FFAA", "TARJETA FF AA", "TARJETA FUERZAS ARMADAS"].includes(
      formaPago
    )
  ) {
    return "FFAA";
  }

  if (["TCT", "TCT MANUAL"].includes(formaPago)) return "TCT";

  if (
    [
      "DEBITO",
      "CREDITO",
      "TARJETA DE DEBITO",
      "TARJETA DE CREDITO",
      "APP COPEC",
      "EFECTIVO",
      "DINERO",
      "CREDITO DOCUMENTADO",
      "RUTPAY",
      "RUT PAY",
      "BILLETERA BANCO ESTADO",
    ].includes(formaPago)
  ) {
    return "VENTA_PROPIA_ISLA";
  }

  return null;
}

export function distribuirCombustiblePoa(valor, litrosOriginales) {
  const producto = normalizar(valor);
  const litros = redondearLitros(litrosOriginales);

  if (litros <= 0 || producto.includes("BLUEMAX") || producto.includes("BLUE MAX")) {
    return [];
  }

  if (producto === "D" || producto.includes("DIESEL") || producto.includes("PETROLEO")) {
    return [{ combustible: "DSL", litros }];
  }

  if (/(^| )93( |$)/.test(producto)) {
    return [{ combustible: "G93", litros }];
  }

  if (/(^| )97( |$)/.test(producto)) {
    return [{ combustible: "G97", litros }];
  }

  if (/(^| )95( |$)/.test(producto)) {
    const mitad = redondearLitros(litros / 2);
    return [
      { combustible: "G93", litros: mitad },
      { combustible: "G97", litros: redondearLitros(litros - mitad) },
    ];
  }

  return [];
}

function agregarVolumen(mapa, {
  fecha,
  codigoEds,
  fuente,
  combustible,
  canal,
  litros,
  transaccionId,
}) {
  const clave = [fecha, combustible, canal].join("|");
  const actual = mapa.get(clave) || {
    fecha,
    codigo_eds: codigoEds || null,
    fuente,
    combustible,
    canal,
    litros: 0,
    transacciones: new Set(),
  };

  actual.litros = redondearLitros(actual.litros + litros);
  if (transaccionId) actual.transacciones.add(transaccionId);
  mapa.set(clave, actual);
}

export function agruparVolumenesCopecFuel(filas, opciones = {}) {
  const fecha = normalizarFecha(opciones.fecha);
  const codigoEds = texto(opciones.codigoEds);
  const mapa = new Map();
  const formasExcluidas = new Map();
  let litrosLeidos = 0;
  let litrosIncluidos = 0;

  for (const [indice, fila] of (filas || []).entries()) {
    const litros = numero(fila?.cantidad);
    const formaOriginal = fila?.formaPagoNombre || fila?.formaPago;
    const canal = clasificarMedioPagoPoa(formaOriginal);
    const distribucion = distribuirCombustiblePoa(
      fila?.productoDescripcion || fila?.productoNombre || fila?.producto,
      litros
    );

    litrosLeidos += Math.max(0, litros);

    if (!canal) {
      const forma = normalizar(formaOriginal) || "SIN IDENTIFICAR";
      formasExcluidas.set(forma, redondearLitros((formasExcluidas.get(forma) || 0) + Math.max(0, litros)));
      continue;
    }

    const transaccionId = texto(
      fila?.transaccionId || fila?.transaccionCodigo || `fila-${indice}`
    );

    for (const parte of distribucion) {
      litrosIncluidos += parte.litros;
      agregarVolumen(mapa, {
        fecha,
        codigoEds,
        fuente: "COPECFUEL",
        combustible: parte.combustible,
        canal,
        litros: parte.litros,
        transaccionId,
      });
    }
  }

  const sincronizadoEn = new Date().toISOString();
  const registros = [...mapa.values()].map((registro) => ({
    identificador_origen: [
      "poa-copecfuel-v1",
      codigoEds || "sin-eds",
      registro.fecha,
      registro.combustible,
      registro.canal,
    ].join("|"),
    fecha: registro.fecha,
    codigo_eds: registro.codigo_eds,
    fuente: registro.fuente,
    combustible: registro.combustible,
    canal: registro.canal,
    litros: redondearLitros(registro.litros),
    transacciones: registro.transacciones.size,
    datos_origen: {
      reglaGasolina95: "50% G93 y 50% G97",
      fuente: "API_OFICIAL_VENTA_COMBUSTIBLE",
    },
    sincronizado_en: sincronizadoEn,
  }));

  return {
    registros,
    diagnostico: {
      filasLeidas: (filas || []).length,
      litrosLeidos: redondearLitros(litrosLeidos),
      litrosIncluidos: redondearLitros(litrosIncluidos),
      formasExcluidas: [...formasExcluidas.entries()].map(([formaPago, litros]) => ({
        formaPago,
        litros,
      })),
    },
  };
}

async function reemplazarRegistros({ fuente, fechaDesde, fechaHasta, codigoEds, registros }) {
  let eliminacion = supabaseAdmin
    .from("poa_volumenes_diarios")
    .delete()
    .eq("fuente", fuente)
    .gte("fecha", fechaDesde)
    .lte("fecha", fechaHasta);

  if (codigoEds) eliminacion = eliminacion.eq("codigo_eds", codigoEds);

  const { error: errorEliminacion } = await eliminacion;
  if (errorEliminacion) {
    throw new Error(`No se pudo reemplazar el volumen POA: ${errorEliminacion.message}`);
  }

  if (registros.length > 0) {
    const { error } = await supabaseAdmin
      .from("poa_volumenes_diarios")
      .upsert(registros, { onConflict: "identificador_origen" });

    if (error) {
      throw new Error(`No se pudo guardar el volumen POA: ${error.message}`);
    }
  }
}

export async function guardarVolumenesPoaCopecFuel(filas, opciones = {}) {
  const fecha = normalizarFecha(opciones.fecha);
  if (!fecha) throw new Error("Falta una fecha valida para guardar el volumen POA.");

  const resultado = agruparVolumenesCopecFuel(filas, opciones);
  await reemplazarRegistros({
    fuente: "COPECFUEL",
    fechaDesde: fecha,
    fechaHasta: fecha,
    codigoEds: texto(opciones.codigoEds),
    registros: resultado.registros,
  });

  return {
    actualizado: true,
    registrosGuardados: resultado.registros.length,
    ...resultado.diagnostico,
  };
}

export async function guardarVolumenesPoaEnRuta(filas, opciones = {}) {
  const fechaDesde = normalizarFecha(opciones.fechaDesde);
  const fechaHasta = normalizarFecha(opciones.fechaHasta);
  const codigoEds = texto(opciones.codigoEds);

  if (!fechaDesde || !fechaHasta) {
    throw new Error("Falta un rango valido para guardar el volumen de En Ruta.");
  }

  const mapa = new Map();
  const filasUnicas = new Set();
  let entregasIncluidas = 0;
  let litrosIncluidos = 0;

  for (const [indice, fila] of (filas || []).entries()) {
    const estado = normalizar(fila?.ESTADO);
    const tipo = normalizar(fila?.TIPO);
    const tipoCompacto = tipo.replace(/\s+/g, "");
    const fecha = normalizarFecha(fila?.["FECHA ESTADO"]);
    const litros = numeroChile(fila?.["LITROS ENTREGADOS"]);
    const canal = tipo === "CONCESIONARIO"
      ? "VENTA_PROPIA_CAMION"
      : tipoCompacto.includes("TAE")
        ? "TAE"
        : null;
    const distribucion = distribuirCombustiblePoa(fila?.PRODUCTO, litros);

    if (
      !["CERRADO", "ENTREGADO"].includes(estado) ||
      !canal ||
      !fecha ||
      fecha < fechaDesde ||
      fecha > fechaHasta ||
      distribucion.length === 0
    ) {
      continue;
    }

    const identidad = [
      fecha,
      texto(fila?.["NUMERO PEDIDO"]),
      texto(fila?.DTE),
      tipo,
      normalizar(fila?.PRODUCTO),
      litros.toFixed(3),
      texto(fila?.DESTINATARIO),
    ].join("|");
    if (filasUnicas.has(identidad)) continue;
    filasUnicas.add(identidad);

    entregasIncluidas += 1;
    const transaccionId = texto(fila?.DTE || fila?.["NUMERO PEDIDO"] || `fila-${indice}`);

    for (const parte of distribucion) {
      litrosIncluidos += parte.litros;
      agregarVolumen(mapa, {
        fecha,
        codigoEds,
        fuente: "ENRUTA",
        combustible: parte.combustible,
        canal,
        litros: parte.litros,
        transaccionId,
      });
    }
  }

  const sincronizadoEn = new Date().toISOString();
  const registros = [...mapa.values()].map((registro) => ({
    identificador_origen: [
      "poa-enruta-v1",
      codigoEds || "sin-eds",
      registro.fecha,
      registro.combustible,
      registro.canal,
    ].join("|"),
    fecha: registro.fecha,
    codigo_eds: registro.codigo_eds,
    fuente: registro.fuente,
    combustible: registro.combustible,
    canal: registro.canal,
    litros: redondearLitros(registro.litros),
    transacciones: registro.transacciones.size,
    datos_origen: {
      fuente: "MONITOR_PEDIDOS_ENRUTA",
      tiposIncluidos: ["CONCESIONARIO", "TAE"],
      reglaGasolina95: "50% G93 y 50% G97",
    },
    sincronizado_en: sincronizadoEn,
  }));

  await reemplazarRegistros({
    fuente: "ENRUTA",
    fechaDesde,
    fechaHasta,
    codigoEds,
    registros,
  });

  return {
    actualizado: true,
    registrosGuardados: registros.length,
    entregasIncluidas,
    litrosIncluidos: redondearLitros(litrosIncluidos),
  };
}

const DEFINICIONES_FILAS = [
  { grupo: "DSL", canal: "TOTAL", etiqueta: "Total Diesel", esTotal: true },
  { grupo: "DSL", canal: "VENTA_PROPIA_ISLA", etiqueta: "Venta Propia · Isla" },
  { grupo: "DSL", canal: "VENTA_PROPIA_CAMION", etiqueta: "Venta Propia · Camión de reparto" },
  { grupo: "DSL", canal: "CUPON", etiqueta: "Cupón electrónico" },
  { grupo: "DSL", canal: "FFAA", etiqueta: "FF.AA." },
  { grupo: "DSL", canal: "CUENTA_EMPRESA", etiqueta: "Cuenta Empresa" },
  { grupo: "DSL", canal: "TCT", etiqueta: "TCT" },
  { grupo: "DSL", canal: "TAE", etiqueta: "TAE" },
  { grupo: "GAS", canal: "TOTAL", etiqueta: "Total Gasolinas", esTotal: true },
  { grupo: "GAS", combustible: "G93", canal: "VENTA_PROPIA_ISLA", etiqueta: "G93 · Venta Propia Isla" },
  { grupo: "GAS", combustible: "G97", canal: "VENTA_PROPIA_ISLA", etiqueta: "G97 · Venta Propia Isla" },
  { grupo: "GAS", canal: "VENTA_PROPIA_CAMION", etiqueta: "Venta Propia · Camión de reparto" },
  { grupo: "GAS", canal: "CUPON", etiqueta: "Cupón electrónico" },
  { grupo: "GAS", canal: "FFAA", etiqueta: "FF.AA." },
  { grupo: "GAS", canal: "CUENTA_EMPRESA", etiqueta: "Cuenta Empresa" },
  { grupo: "GAS", canal: "TCT", etiqueta: "TCT" },
  { grupo: "GAS", canal: "TAE", etiqueta: "TAE" },
];

function coincideDefinicion(registro, definicion) {
  const esGrupo = definicion.grupo === "DSL"
    ? registro.combustible === "DSL"
    : ["G93", "G97"].includes(registro.combustible);

  if (!esGrupo) return false;
  if (definicion.esTotal) return true;
  if (registro.canal !== definicion.canal) return false;
  return !definicion.combustible || registro.combustible === definicion.combustible;
}

export async function obtenerPoaAnual(anioSolicitado, codigoEdsSolicitado) {
  const anio = Number(anioSolicitado);
  if (!Number.isInteger(anio) || anio < 2020 || anio > 2100) {
    const error = new Error("El año POA no es válido.");
    error.status = 400;
    throw error;
  }

  const codigoEds = texto(codigoEdsSolicitado || process.env.COPEC_FUEL_EDS_CODIGO || process.env.COPEC_EDS_CODIGO || process.env.COPEC_ID_EDS || "40098");
  const desde = `${anio}-01-01`;
  const hasta = `${anio}-12-31`;
  let consulta = supabaseAdmin
    .from("poa_volumenes_diarios")
    .select("fecha,codigo_eds,fuente,combustible,canal,litros,transacciones,sincronizado_en")
    .gte("fecha", desde)
    .lte("fecha", hasta)
    .order("fecha", { ascending: true });

  if (codigoEds && codigoEds !== "*") consulta = consulta.eq("codigo_eds", codigoEds);

  const { data, error } = await consulta;
  if (error) {
    throw new Error(`No se pudo consultar el POA: ${error.message}`);
  }

  const registros = data || [];
  const filas = DEFINICIONES_FILAS.map((definicion) => {
    const meses = Array.from({ length: 12 }, (_, indice) => {
      const mes = String(indice + 1).padStart(2, "0");
      return redondearLitros(
        registros
          .filter((registro) => registro.fecha.slice(5, 7) === mes && coincideDefinicion(registro, definicion))
          .reduce((total, registro) => total + numero(registro.litros), 0)
      );
    });

    return {
      ...definicion,
      meses,
      total: redondearLitros(meses.reduce((suma, valor) => suma + valor, 0)),
    };
  });

  const filaDsl = filas.find((fila) => fila.grupo === "DSL" && fila.esTotal === true);
  const filaGas = filas.find((fila) => fila.grupo === "GAS" && fila.esTotal === true);
  const mesesTotales = Array.from({ length: 12 }, (_, indice) =>
    redondearLitros(numero(filaDsl?.meses?.[indice]) + numero(filaGas?.meses?.[indice]))
  );
  const mesesConDatos = mesesTotales.filter((valor) => valor > 0).length;
  const volumenTotal = redondearLitros(mesesTotales.reduce((suma, valor) => suma + valor, 0));
  const proyeccionAnual = mesesConDatos > 0
    ? redondearLitros((volumenTotal / mesesConDatos) * 12)
    : 0;
  const fechas = registros.map((registro) => registro.fecha).filter(Boolean).sort();
  const fuentes = [...new Set(registros.map((registro) => registro.fuente))];

  return {
    anio,
    codigoEds: codigoEds || null,
    unidad: "litros",
    filas,
    mesesTotales,
    resumen: {
      volumenTotal,
      diesel: redondearLitros(numero(filaDsl?.total)),
      gasolinas: redondearLitros(numero(filaGas?.total)),
      mesesConDatos,
      promedioMensual: mesesConDatos > 0 ? redondearLitros(volumenTotal / mesesConDatos) : 0,
      proyeccionAnual,
    },
    cobertura: {
      desde: fechas[0] || null,
      hasta: fechas.at(-1) || null,
      fuentes,
      registros: registros.length,
    },
    reglas: {
      ventaPropiaIsla: "Débito, crédito, App Copec, efectivo/dinero, crédito documentado y Rutpay/Billetera Banco Estado.",
      cuentaEmpresa: "APP COPEC EMPRESA / Muevo Empresa.",
      gas95: "El volumen de Gasolina 95 se distribuye 50% en G93 y 50% en G97.",
      enRuta: "Entregas cerradas o entregadas: TAE y Concesionario (camión de reparto).",
    },
  };
}

export const POA_CANALES = CANALES;
export const POA_COMBUSTIBLES = COMBUSTIBLES;
