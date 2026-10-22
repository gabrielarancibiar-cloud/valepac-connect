import { requireCoseducam, supabaseAdmin } from "../_lib/supabaseAdmin.js";
import { manejarPreparacionWorker } from "../../server/coseducam/preparation.js";
import { clasificarConsumosV2, debeBloquearEmisionV2 } from "../../server/coseducam/comercialV2.js";
import { evaluarEstadoTaeV2 } from "../../server/coseducam/estadoHabilitacionV2.js";
import { createHash, timingSafeEqual } from "node:crypto";
import {
  iniciarSesionCopec,
  obtenerTokenCopecActual,
} from "../copec/login.js";
import { obtenerVentasOficialesCopecFuel } from "../../server/copecfuel/ventasOficiales.js";
import {
  guardarVolumenesPoaCopecFuel,
  guardarVolumenesPoaEnRuta,
  obtenerPoaAnual,
} from "../../server/poa/volumenes.js";
import { sincronizarM2LakeDia } from "../../server/m2Lake/sync.js";

const TAMANO_PAGINA = 1000;
const RUT_COPEC = "995200007";
const RUT_COSEDUCAM = "969636301";
const RUT_COSEDUCAM_SIN_DV = "96963630";
const TCT_TAE_BASE_URL = "https://tct-tae-api.copec.cl/tct-tae";
const ENRUTA_BASE_URL = "https://enrutacopec.cl";
const FORMAS_PAGO = new Set([
  "EFECTIVO",
  "CREDITO",
  "DEBITO",
  "TARJETA DE CREDITO",
  "TARJETA DE DEBITO",
]);
const FORMAS_PAGO_RECOMPRA = new Set([
  "APP COPEC EMPRESA",
  "CUPON ELECTRONICO",
  "MOVIMIENTO BODEGA",
  "TARJETA FFAA",
  "TCT",
  "TCT MANUAL",
  "STORAGE",
]);
const FORMAS_PAGO_COPEC_RECOMPRA = new Set([
  "DINERO",
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

function esRazonSocialCopec(valor) {
  const razonSocial = normalizarTexto(valor);

  return (
    razonSocial === "COPEC S A" ||
    razonSocial === "COPEC SA" ||
    razonSocial.endsWith(" COPEC S A") ||
    razonSocial.endsWith(" COPEC SA")
  );
}

function numero(valor) {
  const resultado = Number(valor);
  return Number.isFinite(resultado) ? resultado : 0;
}

function objetoJson(valor, respaldo = {}) {
  if (valor && typeof valor === "object" && !Array.isArray(valor)) return valor;
  if (typeof valor !== "string" || !valor.trim()) return respaldo;
  try {
    const parsed = JSON.parse(valor);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : respaldo;
  } catch {
    return respaldo;
  }
}

function redondearLitrosGuia(valor) {
  // CopecFuel informa milésimas de litro. Primero se normaliza esa precisión
  // para evitar residuos binarios al sumar y luego se aplica la regla
  // operacional: fracción 0,5 o superior sube; menor que 0,5 baja.
  const litrosNormalizados = Math.round(numero(valor) * 1000) / 1000;
  return Math.floor(litrosNormalizados + 0.5);
}

function numeroChile(valor) {
  if (typeof valor === "number") return numero(valor);

  const texto = String(valor || "")
    .trim()
    .replace(/\./g, "")
    .replace(",", ".");
  const resultado = Number(texto);
  return Number.isFinite(resultado) ? resultado : 0;
}

function lista(valor) {
  return Array.isArray(valor) ? valor : [];
}

function normalizarFecha(valor) {
  const texto = String(valor || "").trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto;

  const coincidencia = texto.match(/^(\d{2})-(\d{2})-(\d{4})(?:\s|$)/);
  return coincidencia
    ? `${coincidencia[3]}-${coincidencia[2]}-${coincidencia[1]}`
    : null;
}

function fechaChilena(valor) {
  const fecha = normalizarFecha(valor);
  return fecha ? fecha.split("-").reverse().join("-") : "";
}

function clasificarProductoEnRuta(valor) {
  const producto = normalizarTexto(valor);

  if (["D", "DIESEL", "PETROLEO DIESEL"].includes(producto)) return "DIESEL";
  if (["93", "G93", "GAS 93", "GASOLINA 93"].includes(producto)) {
    return "GASOLINA 93";
  }
  if (["95", "G95", "GAS 95", "GASOLINA 95"].includes(producto)) {
    return "GASOLINA 95";
  }
  if (["97", "G97", "GAS 97", "GASOLINA 97"].includes(producto)) {
    return "GASOLINA 97";
  }

  return null;
}

function clasificarProductoRecompra(valor) {
  const producto = normalizarTexto(valor);

  if (!producto || producto.includes("BLUEMAX") || producto.includes("BLUE MAX")) {
    return null;
  }

  if (producto.includes("DIESEL")) return "DIESEL";

  for (const octanaje of ["93", "95", "97"]) {
    if (
      new RegExp(`(^| )${octanaje}( |$)`).test(producto) &&
      (producto.includes("GAS") || producto.includes("GASOLINA"))
    ) {
      return `GASOLINA ${octanaje}`;
    }
  }

  return null;
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

async function leerPreciosDieselObservados(desde, hasta) {
  const registros = [];
  let inicio = 0;

  while (true) {
    const { data, error } = await supabaseAdmin
      .from("copecfuel_resumenes")
      .select("fecha_desde, datos_origen, sincronizado_en")
      .gte("fecha_desde", desde)
      .lte("fecha_desde", hasta)
      .order("fecha_desde", { ascending: true })
      .order("sincronizado_en", { ascending: false })
      .range(inicio, inicio + TAMANO_PAGINA - 1);

    if (error) {
      throw new Error(
        `No se pudieron leer los precios observados CopecFuel: ${error.message}`
      );
    }

    const pagina = Array.isArray(data) ? data : [];
    registros.push(...pagina);

    if (pagina.length < TAMANO_PAGINA) break;
    inicio += TAMANO_PAGINA;
  }

  const porFecha = new Map();

  for (const registro of registros) {
    const fecha = normalizarFecha(registro.fecha_desde);
    const observado = registro.datos_origen?.precioDieselObservado;

    if (!fecha || porFecha.has(fecha) || numero(observado?.precio) <= 0) {
      continue;
    }

    porFecha.set(fecha, {
      precio: numero(observado.precio),
      repeticiones: numero(observado.repeticiones),
      transaccionesRevisadas: numero(observado.transaccionesRevisadas),
      preciosDistintos: numero(observado.preciosDistintos),
    });
  }

  return porFecha;
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
    const montoCargos = cargosDia.reduce(
      (total, registro) => total + numero(registro.monto),
      0
    );
    const diferencia = montoVentas - montoCargos;
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
        montoBruto: montoVentas,
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
      montoVentas: 0,
      cantidadCargos: 0,
      montoCargos: 0,
      diferencia: 0,
    }
  );

  return { rango: { desde: rango.desde, hasta: rango.hasta }, resumen, dias };
}

function esAbonoRecompra(movimiento) {
  const datos = movimiento?.datos_origen || {};
  const contenido = normalizarTexto(
    [
      movimiento?.descripcion,
      movimiento?.tipo_movimiento,
      movimiento?.referencia,
      JSON.stringify(datos),
    ].join(" ")
  );

  return numero(movimiento?.monto) > 0 && contenido.includes("RECOMPRA");
}

async function leerAbonosRecompra(desde, hasta) {
  const registros = [];
  let inicio = 0;

  while (true) {
    const { data, error } = await supabaseAdmin
      .from("copec_movimientos")
      .select(
        "id, fecha_movimiento, descripcion, referencia, tipo_movimiento, monto, id_eds, datos_origen"
      )
      .eq("activo", true)
      .gte("fecha_movimiento", desde)
      .lte("fecha_movimiento", hasta)
      .order("fecha_movimiento", { ascending: true })
      .range(inicio, inicio + TAMANO_PAGINA - 1);

    if (error) {
      throw new Error(`No se pudieron leer los abonos Recompra: ${error.message}`);
    }

    const pagina = Array.isArray(data) ? data : [];
    registros.push(...pagina.filter(esAbonoRecompra));

    if (pagina.length < TAMANO_PAGINA) break;
    inicio += TAMANO_PAGINA;
  }

  return registros.map((registro) => ({
    ...registro,
    fecha: registro.fecha_movimiento,
  }));
}

async function leerPreciosCosto(hasta) {
  const { data, error } = await supabaseAdmin
    .from("copec_precios_costo")
    .select(
      "codigo_eds, fecha_vigencia, localidad, gas_93sp, gas_95sp, gas_97sp, diesel_pdua1"
    )
    .lte("fecha_vigencia", hasta)
    .order("fecha_vigencia", { ascending: true });

  if (error) {
    throw new Error(`No se pudieron leer los precios costo: ${error.message}`);
  }

  return Array.isArray(data) ? data : [];
}

async function leerAjustesRecompra(desde, hasta) {
  return leerTabla(
    "recompra_ajustes",
    "id, identificador_origen, fecha, codigo_eds, tipo, producto, litros, referencia, descripcion, fuente",
    desde,
    hasta
  );
}

function campoPrecioProducto(producto) {
  const nombre = normalizarTexto(producto);

  if (nombre === "GASOLINA 93") return "gas_93sp";
  if (nombre === "GASOLINA 95") return "gas_95sp";
  if (nombre === "GASOLINA 97") return "gas_97sp";
  if (nombre === "DIESEL") return "diesel_pdua1";
  return null;
}

function precioVigenteParaVenta(venta, precios) {
  const campo = campoPrecioProducto(venta.producto);

  if (!campo) return null;

  const vigente = precios
    .filter(
      (precio) =>
        String(precio.codigo_eds || "") === String(venta.codigo_eds || "") &&
        precio.fecha_vigencia <= venta.fecha
    )
    .at(-1);
  const valor = numero(vigente?.[campo]);

  return vigente && valor > 0
    ? {
        valor,
        fechaVigencia: vigente.fecha_vigencia,
        localidad: vigente.localidad,
      }
    : null;
}

function diaAnterior(fecha) {
  const valor = new Date(`${fecha}T12:00:00Z`);
  valor.setUTCDate(valor.getUTCDate() - 1);
  return valor.toISOString().slice(0, 10);
}

function prepararHistorialPrecios(precios) {
  return precios
    .map((precio, indice) => ({
      codigoEds: precio.codigo_eds,
      localidad: precio.localidad,
      vigenteDesde: precio.fecha_vigencia,
      vigenteHasta: precios[indice + 1]
        ? diaAnterior(precios[indice + 1].fecha_vigencia)
        : null,
      gas93: numero(precio.gas_93sp),
      gas95: numero(precio.gas_95sp),
      gas97: numero(precio.gas_97sp),
      diesel: numero(precio.diesel_pdua1),
    }))
    .reverse()
    .slice(0, 30);
}

async function obtenerMesRecompraLake(periodo) {
  const rango = rangoMes(periodo);

  if (!rango) {
    const error = new Error("El periodo debe usar el formato AAAA-MM.");
    error.status = 400;
    throw error;
  }

  const [bases, estadosLake, abonos, precios, ajustes] = await Promise.all([
    leerTabla(
      "recompra_resumen_diario",
      "fecha, codigo_eds, cantidad_operaciones, lineas, litros_base, monto_venta_referencia, formas_pago, productos, actualizado_en",
      rango.desde,
      rango.hasta
    ),
    leerTabla(
      "recompra_estado_diario",
      "fecha, estado, cantidad_registros, ventas_elegibles, ventas_unicas, duplicadas, excluidas, coseducam_lineas, capturado_en, procesado_en, actualizado_en, diagnostico",
      rango.desde,
      rango.hasta
    ),
    leerAbonosRecompra(rango.desde, rango.hasta),
    leerPreciosCosto(rango.hasta),
    leerAjustesRecompra(rango.desde, rango.hasta),
  ]);

  const basePorFecha = new Map(bases.map((fila) => [fila.fecha, fila]));
  const estadoPorFecha = new Map(estadosLake.map((fila) => [fila.fecha, fila]));
  const abonosPorFecha = agruparPorFecha(abonos);
  const ajustesPorFecha = agruparPorFecha(ajustes);

  const dias = rango.fechas.map((fecha) => {
    const baseDia = basePorFecha.get(fecha) || null;
    const estadoLake = estadoPorFecha.get(fecha) || null;
    const abonosDia = abonosPorFecha.get(fecha) || [];
    const ajustesDia = ajustesPorFecha.get(fecha) || [];
    const productosRaw = objetoJson(baseDia?.productos);
    const formasPago = objetoJson(baseDia?.formas_pago);

    const productosBase = new Map(
      Object.entries(productosRaw).map(([producto, detalle]) => [
        producto,
        {
          producto,
          codigoEds: detalle?.codigoEds || baseDia?.codigo_eds || null,
          litrosBase: numero(detalle?.litrosBase),
          lineas: numero(detalle?.lineas),
        },
      ])
    );

    const ajustesProducto = new Map();
    for (const ajuste of ajustesDia) {
      const producto = String(ajuste.producto || "DIESEL");
      const actual = ajustesProducto.get(producto) || {
        codigoEds: ajuste.codigo_eds,
        volumenPropio: 0,
        fluctuacionMesa: 0,
        tctTaeManual: 0,
      };
      const litrosAjuste = numero(ajuste.litros);

      if (ajuste.tipo === "volumen_propio") {
        actual.volumenPropio += litrosAjuste;
      } else if (ajuste.tipo === "fluctuacion_mesa") {
        actual.fluctuacionMesa += litrosAjuste;
      } else if (ajuste.tipo === "tct_tae_manual") {
        actual.tctTaeManual += litrosAjuste;
      }

      ajustesProducto.set(producto, actual);
    }

    const nombresProducto = new Set([
      ...productosBase.keys(),
      ...ajustesProducto.keys(),
    ]);
    const detallesCosto = [...nombresProducto].map((producto) => {
      const base = productosBase.get(producto) || {};
      const ajuste = ajustesProducto.get(producto) || {};
      const codigoEds =
        base.codigoEds ||
        ajuste.codigoEds ||
        process.env.COPEC_EDS_PRECIOS ||
        process.env.COPEC_ID_EDS ||
        "40098";
      const litrosBase = numero(base.litrosBase);
      const volumenPropio = numero(ajuste.volumenPropio);
      const fluctuacionMesa = numero(ajuste.fluctuacionMesa);
      const tctTaeManual = numero(ajuste.tctTaeManual);
      const litrosNetos =
        litrosBase - volumenPropio + fluctuacionMesa + tctTaeManual;
      const precio = precioVigenteParaVenta(
        { fecha, codigo_eds: codigoEds, producto },
        precios
      );
      const costoExacto = precio ? litrosNetos * precio.valor : 0;

      return {
        producto,
        codigoEds,
        lineas: numero(base.lineas),
        litrosBase,
        volumenPropio,
        fluctuacionMesa,
        tctTaeManual,
        litrosNetos,
        precio,
        costoExacto,
      };
    });

    const litrosBase = detallesCosto.reduce(
      (total, detalle) => total + detalle.litrosBase,
      0
    );
    const volumenPropio = detallesCosto.reduce(
      (total, detalle) => total + detalle.volumenPropio,
      0
    );
    const fluctuacionMesa = detallesCosto.reduce(
      (total, detalle) => total + detalle.fluctuacionMesa,
      0
    );
    const tctTaeManual = detallesCosto.reduce(
      (total, detalle) => total + detalle.tctTaeManual,
      0
    );
    const litros = detallesCosto.reduce(
      (total, detalle) => total + detalle.litrosNetos,
      0
    );
    const costoExacto = detallesCosto.reduce(
      (total, detalle) => total + detalle.costoExacto,
      0
    );
    const costoVentas = Math.round(costoExacto);
    const lineasSinPrecio = detallesCosto.filter(
      (detalle) => Math.abs(detalle.litrosNetos) > 0 && !detalle.precio
    ).length;
    const montoAbonos = abonosDia.reduce(
      (total, abono) => total + numero(abono.monto),
      0
    );
    const diferencia = montoAbonos - costoVentas;
    let estado = "diferencia";
    const lineas = numero(baseDia?.lineas);

    if (lineas > 0 && lineasSinPrecio > 0) estado = "sin_precio";
    else if (costoVentas === 0 && montoAbonos === 0) estado = "sin_datos";
    else if (costoVentas === 0) estado = "sin_ventas";
    else if (montoAbonos === 0) estado = "sin_abonos";
    else if (diferencia === 0) estado = "conciliado";

    const productos = detallesCosto.reduce((grupos, detalle) => {
      grupos[detalle.producto] = {
        litrosBase: detalle.litrosBase,
        volumenPropio: detalle.volumenPropio,
        fluctuacionMesa: detalle.fluctuacionMesa,
        tctTaeManual: detalle.tctTaeManual,
        litros: detalle.litrosNetos,
        costo: detalle.costoExacto,
        precioCosto: detalle.precio?.valor || null,
        fechaVigencia: detalle.precio?.fechaVigencia || null,
      };
      return grupos;
    }, {});

    return {
      fecha,
      estado,
      estadoLake: estadoLake?.estado || (baseDia ? "PROCESADO" : "SIN_PROCESAR"),
      ventas: {
        cantidad: numero(baseDia?.cantidad_operaciones),
        lineas,
        litrosBase,
        volumenPropio,
        fluctuacionMesa,
        tctTaeManual,
        litros,
        montoVentaReferencia: numero(baseDia?.monto_venta_referencia),
        costoExacto,
        costo: costoVentas,
        ajusteRedondeo: costoVentas - costoExacto,
        lineasSinPrecio,
        formasPago,
        productos,
      },
      ajustes: ajustesDia.map((ajuste) => ({
        id: ajuste.id,
        tipo: ajuste.tipo,
        producto: ajuste.producto,
        litros: numero(ajuste.litros),
        referencia: ajuste.referencia,
        descripcion: ajuste.descripcion,
        fuente: ajuste.fuente,
      })),
      abonos: {
        cantidad: abonosDia.length,
        monto: montoAbonos,
      },
      diferencia,
    };
  });

  const resumen = dias.reduce(
    (total, dia) => {
      total.diasConciliados += dia.estado === "conciliado" ? 1 : 0;
      total.diasConDiferencia += dia.estado === "diferencia" ? 1 : 0;
      total.diasPendientes +=
        ["sin_ventas", "sin_abonos", "sin_precio"].includes(dia.estado)
          ? 1
          : 0;
      total.cantidadVentas += dia.ventas.cantidad;
      total.litrosBase += dia.ventas.litrosBase;
      total.volumenPropio += dia.ventas.volumenPropio;
      total.fluctuacionMesa += dia.ventas.fluctuacionMesa;
      total.tctTaeManual += dia.ventas.tctTaeManual;
      total.litros += dia.ventas.litros;
      total.montoVentaReferencia += dia.ventas.montoVentaReferencia;
      total.costoVentas += dia.ventas.costo;
      total.lineasSinPrecio += dia.ventas.lineasSinPrecio;
      total.cantidadAbonos += dia.abonos.cantidad;
      total.montoAbonos += dia.abonos.monto;
      total.diferencia += dia.diferencia;
      return total;
    },
    {
      diasConciliados: 0,
      diasConDiferencia: 0,
      diasPendientes: 0,
      cantidadVentas: 0,
      litrosBase: 0,
      volumenPropio: 0,
      fluctuacionMesa: 0,
      tctTaeManual: 0,
      litros: 0,
      montoVentaReferencia: 0,
      costoVentas: 0,
      lineasSinPrecio: 0,
      cantidadAbonos: 0,
      montoAbonos: 0,
      diferencia: 0,
    }
  );

  return {
    rango: { desde: rango.desde, hasta: rango.hasta },
    resumen,
    dias,
    preciosCosto: prepararHistorialPrecios(precios),
    ajustesManuales: ajustes
      .filter((ajuste) => ajuste.tipo === "tct_tae_manual")
      .map((ajuste) => ({
        id: ajuste.id,
        fecha: ajuste.fecha,
        producto: ajuste.producto,
        litros: numero(ajuste.litros),
        referencia: ajuste.referencia,
        descripcion: ajuste.descripcion,
      })),
    fuenteDatos: "RECOMPRA_LAKE",
    estadosLake,
  };
}

async function obtenerMesCoseducamLake(periodo) {
  const rango = rangoMes(periodo);

  if (!rango) {
    const error = new Error("El periodo debe usar el formato AAAA-MM.");
    error.status = 400;
    throw error;
  }

  const [ventas, guias, jobs, estadosLake] = await Promise.all([
    leerTabla(
      "coseducam_consumos",
      "fecha, codigo_eds, transaccion_id, transaccion_codigo, producto, litros, patente, precio_unitario, fecha_cierre_copec, fecha_cierre_copec_raw",
      rango.desde,
      rango.hasta
    ),
    leerTabla(
      "coseducam_guias",
      "id, fecha, codigo_eds, litros, estado, numero_guia, codigo_autorizacion, mensaje, creada_en, confirmada_en",
      rango.desde,
      rango.hasta
    ),
    leerTabla(
      "coseducam_jobs",
      "id, fecha, codigo_eds, estado, etapa_previa, intentos_tae, intentos_enruta, numero_guia",
      rango.desde,
      rango.hasta
    ),
    leerTabla(
      "recompra_estado_diario",
      "fecha,estado,sha256,capturado_en,procesado_en,coseducam_lineas",
      rango.desde, rango.hasta
    ),
  ]);

  const ventasPorFecha = agruparPorFecha(ventas);
  const guiaPorFecha = new Map(guias.map((guia) => [guia.fecha, guia]));
  const jobPorFecha = new Map(jobs.map((job) => [job.fecha, job]));
  const lakePorFecha = new Map(estadosLake.map((r) => [r.fecha, r]));
  const dias = rango.fechas.map((fecha) => {
    const calculo = clasificarConsumosV2(fecha, ventasPorFecha.get(fecha) || []);
    const guia = guiaPorFecha.get(fecha) || null;
    const job = jobPorFecha.get(fecha) || null;
    const estado = guia?.estado || (job ? "revision_requerida" :
      calculo.litros > 0 ? "pendiente_guia" : "sin_consumo");
    return {
      fecha, estado,
      dataLake: lakePorFecha.get(fecha) || null,
      historicoSoloConsulta: calculo.historico,
      consumo: {
        litros: calculo.litros,
        transacciones: calculo.transacciones,
        lineas: calculo.registros,
        registrosExcluidos: calculo.registrosExcluidos,
        litrosExcluidos: calculo.litrosExcluidos,
        registrosInvalidos: calculo.invalidos.length,
        datosCompletos: calculo.completo,
        precioTae: calculo.precioTae,
        // Alias solo de compatibilidad visual, NUNCA lectura de la moda.
        precioDieselObservado: calculo.precioTae === null ? null : {
          precio: calculo.precioTae, fuente: "STORAGE_COSEDUCAM_MAX",
        },
        detalle: calculo.elegibles.map((venta) => ({
          transaccion: venta.transaccion_codigo || venta.transaccion_id || "Sin referencia",
          producto: venta.producto || "DIESEL",
          litros: numero(venta.litros),
          precioUnitario: venta.precio_unitario === null ? null : numero(venta.precio_unitario),
          patente: venta.patente || null,
        })),
      },
      job: job ? { estado: job.estado, etapa: job.etapa_previa } : null,
      guia: guia ? {
        id: guia.id, estado: guia.estado, litros: numero(guia.litros),
        numeroGuia: guia.numero_guia, codigoAutorizacion: guia.codigo_autorizacion,
        mensaje: guia.mensaje, creadaEn: guia.creada_en,
        confirmadaEn: guia.confirmada_en,
      } : null,
    };
  });

  const resumen = dias.reduce(
    (total, dia) => {
      total.litros += dia.consumo.litros;
      total.transacciones += dia.consumo.transacciones;
      total.diasConConsumo += dia.consumo.litros > 0 ? 1 : 0;
      total.guiasCreadas += ["creada", "confirmada"].includes(dia.estado)
        ? 1
        : 0;
      total.guiasConfirmadas += dia.estado === "confirmada" ? 1 : 0;
      total.pendientes += dia.estado === "pendiente_guia" ? 1 : 0;
      return total;
    },
    {
      litros: 0,
      transacciones: 0,
      diasConConsumo: 0,
      guiasCreadas: 0,
      guiasConfirmadas: 0,
      pendientes: 0,
    }
  );

  return {
    rango: { desde: rango.desde, hasta: rango.hasta },
    cliente: {
      razonSocial: "COSEDUCAM S.A.",
      rut: "96.963.630-1",
      formaPago: "STORAGE",
      producto: "DIESEL",
    },
    resumen,
    dias,
    confirmacionEnRutaDisponible: process.env.COSEDUCAM_ENRUTA_V2_HABILITADA === "true",
    emisionTaeDisponible: process.env.COSEDUCAM_TAE_V2_HABILITADA === "true",
    flujo: "COSEDUCAM_V2",
    corte: "23:50:00",
    fuenteDatos: "COSEDUCAM_LAKE",
  };
}

function fechaChileHoy() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function diferenciaNumero(a, b) {
  return numero(b) - numero(a);
}

function obtenerRutCoseducam(venta) {
  const origen = venta?.datos_origen || {};
  const candidatos = [
    origen.clienteRutRut,
    origen.rutEmpresaReceptor,
    origen.rutCliente,
    origen.rut_cliente,
    origen["RUT CLIENTE"],
  ];

  return candidatos.map(normalizarRut).find((rut) => rut === RUT_COSEDUCAM);
}

function esVentaStorageCoseducam(venta) {
  const origen = venta?.datos_origen || {};
  const razonesSociales = [
    origen.clienteRutRazonSocial,
    origen.razonSocialReceptor,
    origen.razonSocialCliente,
    origen["RAZON SOCIAL CLIENTE"],
  ].map(normalizarTexto);

  return (
    normalizarTexto(venta?.forma_pago) === "STORAGE" &&
    clasificarProductoRecompra(venta?.producto) === "DIESEL" &&
    (Boolean(obtenerRutCoseducam(venta)) ||
      razonesSociales.some((razon) => razon.includes("COSEDUCAM")))
  );
}

function detalleCoseducam(venta) {
  const origen = venta?.datos_origen || {};

  return {
    transaccion:
      venta.transaccion_codigo || venta.transaccion_id || "Sin referencia",
    producto: venta.producto || "DIESEL",
    litros: numero(venta.cantidad),
    patente:
      String(
        origen.patente || origen.patenteVehiculo || origen["PATENTE"] || ""
      ).trim() || null,
  };
}

async function solicitarTctTae(ruta, opciones = {}) {
  const ejecutar = async (token) => {
    const respuesta = await fetch(`${TCT_TAE_BASE_URL}${ruta}`, {
      ...opciones,
      headers: {
        Accept: "application/json",
        Origin: "https://tct-tae.copec.cl",
        Referer: "https://tct-tae.copec.cl/",
        token,
        ...(opciones.body ? { "Content-Type": "application/json" } : {}),
        ...(opciones.headers || {}),
      },
    });
    const texto = await respuesta.text();
    let payload = null;

    try {
      payload = texto ? JSON.parse(texto) : {};
    } catch {
      payload = { raw: texto.slice(0, 500) };
    }

    return { respuesta, payload };
  };

  let token = obtenerTokenCopecActual();

  if (!token) {
    token = (await iniciarSesionCopec()).accessToken;
  }

  let resultado = await ejecutar(token);

  if ([401, 403].includes(resultado.respuesta.status)) {
    token = (await iniciarSesionCopec()).accessToken;
    resultado = await ejecutar(token);
  }

  if (!resultado.respuesta.ok) {
    const error = new Error(
      resultado.payload?.userMessage ||
        resultado.payload?.message ||
        `Portal TCT/TAE rechazó la solicitud con estado ${resultado.respuesta.status}.`
    );
    error.status = resultado.respuesta.status;
    throw error;
  }

  return resultado.payload;
}

async function obtenerConfiguracionGuiaCoseducam(codigoEds) {
  const clientePayload = await solicitarTctTae(
    `/obtener-clientes-autorizacion?RUT=${RUT_COSEDUCAM_SIN_DV}`
  );
  const cliente = lista(clientePayload?.data?.clientes)[0];

  if (!cliente?.codigo_sin_digito) {
    throw new Error("Portal TCT/TAE no devolvió el cliente Coseducam.");
  }

  const codigoCliente = cliente.codigo_sin_digito;
  const [tarjetasPayload, subproductosPayload, fletePayload] =
    await Promise.all([
      solicitarTctTae(
        `/obtener-tarjetas-cliente?CODCLIENTE=${encodeURIComponent(
          codigoCliente
        )}&PRODUCTO=TAE&IDEDS=${encodeURIComponent(codigoEds)}`
      ),
      solicitarTctTae(
        `/obtener-subproductos?CODPRODUCTO=001&IDEDS=${encodeURIComponent(
          codigoEds
        )}`
      ),
      solicitarTctTae(
        `/obtener-flete?RUT=${RUT_COSEDUCAM_SIN_DV}&IDEDS=${encodeURIComponent(
          codigoEds
        )}`
      ),
    ]);
  const tarjetas = lista(tarjetasPayload?.data?.tarjetas);
  const tarjetaPreferida = String(
    process.env.COSEDUCAM_TARJETA_TAE || "1-424517-00668-9-4"
  ).trim();
  const tarjeta =
    tarjetas.find((item) => item.numero_tarjeta === tarjetaPreferida) ||
    tarjetas.find(
      (item) =>
        normalizarTexto(item.tipo_tae) === "TAE DESPACHO" &&
        normalizarTexto(item.producto).includes("DIESEL")
    );
  const subproducto = lista(subproductosPayload?.data?.subproductos).find(
    (item) => String(item.codigo) === "001"
  );

  if (!tarjeta) {
    throw new Error("No se encontró una tarjeta TAE Despacho diésel para Coseducam.");
  }

  if (!subproducto) {
    throw new Error("Portal TCT/TAE no devolvió el producto diésel para la guía.");
  }

  return {
    cliente,
    tarjeta,
    subproducto,
    flete: numero(fletePayload?.data?.flete),
  };
}

async function crearGuiaCoseducam(request) {
  const fecha = normalizarFecha(request.body?.fecha);
  const codigoEds = String(
    request.body?.codigoEds || process.env.COPEC_ID_EDS || "40098"
  ).trim();
  const confirmarPrecioObservado =
    request.body?.confirmarPrecioObservado === true;

  if (!fecha || !codigoEds) {
    const error = new Error("Falta una fecha válida o el código de la estación.");
    error.status = 400;
    throw error;
  }

  const ventas = await leerTabla(
    "coseducam_consumos",
    "fecha, codigo_eds, transaccion_id, transaccion_codigo, producto, litros, patente",
    fecha,
    fecha
  );
  const ventasElegibles = ventas.filter(
    (venta) => !venta.codigo_eds || String(venta.codigo_eds) === codigoEds
  );
  const litrosCalculados = ventasElegibles.reduce(
    (total, venta) => total + numero(venta.litros),
    0
  );
  const litros = redondearLitrosGuia(litrosCalculados);

  if (litrosCalculados <= 0 || litros <= 0) {
    const error = new Error(
      "No existen litros STORAGE diésel de Coseducam para la fecha seleccionada."
    );
    error.status = 400;
    throw error;
  }

  const { data: guiaExistente, error: errorConsulta } = await supabaseAdmin
    .from("coseducam_guias")
    .select("id, estado, numero_guia, codigo_autorizacion")
    .eq("fecha", fecha)
    .eq("codigo_eds", codigoEds)
    .maybeSingle();

  if (errorConsulta) {
    throw new Error(`No se pudo validar la guía existente: ${errorConsulta.message}`);
  }

  if (guiaExistente) {
    const error = new Error(
      `La fecha ya tiene una guía en estado ${guiaExistente.estado}. No se creó otra.`
    );
    error.status = 409;
    throw error;
  }

  const preciosObservados = await leerPreciosDieselObservados(fecha, fecha);
  const precioObservado = Math.round(
    numero(preciosObservados.get(fecha)?.precio)
  );

  if (precioObservado <= 0) {
    const error = new Error(
      "No existe un precio diésel observado para esta fecha. Sincroniza primero las ventas CopecFuel del día."
    );
    error.status = 409;
    error.requiereSincronizacionPrecio = true;
    throw error;
  }

  const configuracion = await obtenerConfiguracionGuiaCoseducam(codigoEds);
  const precioPortal = Math.round(numero(configuracion.subproducto.precio));
  const precioNoCoincide = precioPortal !== precioObservado;

  if (precioNoCoincide && !confirmarPrecioObservado) {
    const error = new Error(
      `El precio propuesto por Portal TCT/TAE ($${precioPortal.toLocaleString(
        "es-CL"
      )}) no coincide con el precio observado ($${precioObservado.toLocaleString(
        "es-CL"
      )}). Confirma el reemplazo para continuar.`
    );
    error.status = 409;
    error.requiereConfirmacionPrecio = true;
    error.precioPortal = precioPortal;
    error.precioObservado = precioObservado;
    throw error;
  }

  const { data: bloqueo, error: errorBloqueo } = await supabaseAdmin
    .from("coseducam_guias")
    .insert({
      fecha,
      codigo_eds: codigoEds,
      rut_cliente: "96.963.630-1",
      litros,
      estado: "procesando",
      mensaje: "Solicitando autorización al Portal TCT/TAE.",
    })
    .select("id")
    .single();

  if (errorBloqueo) {
    const error = new Error(
      errorBloqueo.code === "23505"
        ? "Ya existe un proceso de guía para esta fecha."
        : `No se pudo iniciar la guía: ${errorBloqueo.message}`
    );
    error.status = errorBloqueo.code === "23505" ? 409 : 500;
    throw error;
  }

  try {
    // La guía siempre utiliza el precio observado calculado desde ventas asistidas.
    // El precio sugerido por Portal TCT/TAE se conserva solo para auditoría.
    const precio = precioObservado;
    const payloadAutorizacion = {
      id_eds: String(parseInt(codigoEds, 10)),
      codigo_cliente: String(
        parseInt(configuracion.cliente.codigo_sin_digito, 10)
      ),
      numero_tarjeta: configuracion.tarjeta.numero_tarjeta,
      cod_producto: "001",
      precio,
      rut: process.env.COPEC_RUT_CONCESIONARIO || "78229820-8",
      nombre_rut:
        process.env.COPEC_NOMBRE_CONCESIONARIO || "VALENCIA Y PACHECO LTDA.",
      cod_motivo: "0002",
      monto: Math.ceil(litros * precio),
      unidad: litros.toFixed(2),
      cod_subproducto: "001",
      direccion: String(
        request.body?.direccion ||
          process.env.COSEDUCAM_DIRECCION ||
          "fuenzalida 31"
      ).trim(),
      cod_comuna: process.env.COSEDUCAM_COD_COMUNA || "13501",
      flete: Math.round(configuracion.flete),
      orden_compra: "",
      comuna: process.env.COSEDUCAM_COMUNA || "Melipilla",
      tae_retiro: false,
    };
    const respuestaAutorizacion = await solicitarTctTae("/autorizar-consumo", {
      method: "POST",
      body: JSON.stringify(payloadAutorizacion),
    });
    const datos = respuestaAutorizacion?.data || {};

    if (!respuestaAutorizacion?.data || typeof datos.error !== "string") {
      throw new Error(
        "Portal TCT/TAE respondió sin confirmar el resultado de la autorización."
      );
    }

    const errorCopec = String(datos.error || "").trim();

    if (errorCopec) {
      throw new Error(errorCopec);
    }

    const numeroGuia = String(datos.numero_guia || "").trim() || null;
    const codigoAutorizacion =
      String(datos.codigo_autorizacion || "").trim() || null;

    if (!numeroGuia && !codigoAutorizacion) {
      throw new Error(
        "Portal TCT/TAE no devolvió número de guía ni código de autorización."
      );
    }

    const mensaje =
      String(datos.mensaje || "").trim() || "Guía creada correctamente.";
    const { error: errorActualizacion } = await supabaseAdmin
      .from("coseducam_guias")
      .update({
        estado: "creada",
        numero_guia: numeroGuia,
        codigo_autorizacion: codigoAutorizacion,
        mensaje,
        respuesta_autorizacion: {
          litrosCalculados,
          litrosGuia: litros,
          reglaRedondeo: "0,5 o superior hacia arriba; menor a 0,5 hacia abajo",
          precioPortal,
          precioObservado,
          precioAplicado: precio,
          precioReemplazado: precioNoCoincide,
          respuesta: respuestaAutorizacion,
        },
        creada_en: new Date().toISOString(),
        sincronizado_en: new Date().toISOString(),
      })
      .eq("id", bloqueo.id);

    if (errorActualizacion) {
      throw new Error(
        `La autorización respondió, pero no pudo registrarse: ${errorActualizacion.message}`
      );
    }

    return {
      fecha,
      litros,
      litrosCalculados,
      numeroGuia,
      codigoAutorizacion,
      mensaje,
      precioPortal,
      precioObservado,
      precioAplicado: precio,
      precioReemplazado: precioNoCoincide,
    };
  } catch (error) {
    await supabaseAdmin
      .from("coseducam_guias")
      .update({
        estado: "revision_requerida",
        mensaje:
          error instanceof Error ? error.message : "Error al crear la guía.",
        sincronizado_en: new Date().toISOString(),
      })
      .eq("id", bloqueo.id);

    throw error;
  }
}

async function solicitarMonitorEntregaEnRuta(body, { reintentar = false } = {}) {
  const intentos = reintentar ? 2 : 1;
  let ultimoError;

  for (let intento = 1; intento <= intentos; intento += 1) {
    try {
      const respuesta = await fetch(
        `${ENRUTA_BASE_URL}/fetch/elementos/f_MonitorEntrega.aspx`,
        {
          method: "POST",
          headers: {
            Accept: "*/*",
            "Content-Type":
              "application/x-www-form-urlencoded; charset=UTF-8",
            Origin: ENRUTA_BASE_URL,
            Referer: `${ENRUTA_BASE_URL}/MonitorEntrega.aspx`,
            "X-Requested-With": "XMLHttpRequest",
          },
          body: body.toString(),
        }
      );
      const texto = await respuesta.text();

      if (!respuesta.ok) {
        const error = new Error(
          `Copec en Ruta rechazó la solicitud con estado ${respuesta.status}.`
        );
        error.status = respuesta.status;
        throw error;
      }

      return texto;
    } catch (error) {
      ultimoError = error;
      const puedeReintentar =
        intento < intentos &&
        (!error?.status || [502, 503, 504].includes(error.status));

      if (!puedeReintentar) throw error;
    }
  }

  throw ultimoError;
}

function separarRespuestaEnRuta(texto) {
  return String(texto || "")
    .replace(/Â§/g, "§")
    .split("§")
    .map((valor) => valor.trim());
}

async function buscarPedidoEnRuta({ numeroGuia, codigoEds }) {
  const consultar = async (guia, permitirRespuestaNoJson = false) => {
    const texto = await solicitarMonitorEntregaEnRuta(
      new URLSearchParams({
        accion: "gMonitorPedido",
        hr: "",
        pedido: "",
        destinatario: "",
        estacion: codigoEds,
        guia,
        fini: "",
        ffini: "",
        usuario: codigoEds,
        _search: "false",
        nd: String(Date.now()),
        rows: "100",
        page: "1",
        sidx: "CONVERT(DATETIME,FECHA,105)",
        sord: "desc",
      }),
      { reintentar: true }
    );

    try {
      const payload = JSON.parse(texto);
      return lista(payload?.rows);
    } catch {
      // El filtro por guia del portal contiene un defecto SQL y puede
      // responder `0§Incorrect syntax...`. Esa respuesta no significa que la
      // guia no exista: se continua con la bandeja completa de la EDS.
      if (permitirRespuestaNoJson) return [];

      throw new Error(
        "Copec en Ruta respondió sin el listado esperado de guías."
      );
    }
  };
  const encontrar = (filas) =>
    filas.find(
    (fila) =>
      String(fila?.GUIA || "").trim() === numeroGuia &&
      String(fila?.ESTACION || "").trim() === codigoEds
    );
  let pedido = encontrar(await consultar(numeroGuia, true));

  // El portal no siempre aplica el filtro `guia`. Si no devuelve el pedido,
  // se consulta la bandeja reciente de la EDS y se busca la coincidencia
  // exacta. La validacion posterior de RUT, cliente, producto y litros sigue
  // siendo obligatoria antes de confirmar.
  if (!pedido) pedido = encontrar(await consultar(""));

  if (!pedido?.NUMEROPEDIDO) {
    const error = new Error(
      `La guía ${numeroGuia} aún no aparece pendiente en Copec en Ruta. Intenta nuevamente cuando se encuentre disponible.`
    );
    error.status = 409;
    throw error;
  }

  return pedido;
}

async function obtenerDetallePedidoEnRuta(numeroPedido) {
  const texto = await solicitarMonitorEntregaEnRuta(
    new URLSearchParams({
      accion: "infoModificar",
      id: numeroPedido,
    }),
    { reintentar: true }
  );
  const partes = separarRespuestaEnRuta(texto);

  if (partes[0] !== "1" || partes.length < 21) {
    throw new Error(
      "Copec en Ruta no devolvió los datos completos de la guía."
    );
  }

  return {
    rut: partes[1],
    razon: partes[2],
    guia: partes[5],
    tarjeta: partes[6],
    codigoCliente: partes[7],
    codigoProducto: partes[8],
    volumen: numeroChile(partes[9]),
    precio: numeroChile(partes[10]),
    monto: numeroChile(partes[11]),
    direccion: partes[12],
    comunaTexto: partes[13],
    flete: numeroChile(partes[14]),
    comuna: partes[15],
    codigoInstalacion: partes[16],
    responsable: partes[17],
    fechaAutorizacion: partes[18],
    horaAutorizacion: partes[19],
    codigoAutorizacion: partes[20],
  };
}

function validarPedidoCoseducam({ guia, pedido, detalle }) {
  if (normalizarRut(detalle.rut) !== RUT_COSEDUCAM) {
    throw new Error(
      "La guía localizada en Copec en Ruta no pertenece al RUT de Coseducam. No se confirmó."
    );
  }

  if (!normalizarTexto(detalle.razon).includes("COSEDUCAM")) {
    throw new Error(
      "La razón social de la guía no corresponde a Coseducam. No se confirmó."
    );
  }

  if (
    normalizarTexto(pedido?.PRODUCTO) !== "D" &&
    !normalizarTexto(pedido?.PRODUCTO).includes("DIESEL")
  ) {
    throw new Error("La guía localizada no corresponde a diésel.");
  }

  if (
    String(detalle.guia || "").trim() !== String(guia.numero_guia).trim()
  ) {
    throw new Error("El número de guía de En Ruta no coincide con Coseducam.");
  }

  if (!String(detalle.codigoAutorizacion || "").trim()) {
    throw new Error(
      "Copec en Ruta no informó el código interno de autorización de la guía."
    );
  }

  const litrosGuia = redondearLitrosGuia(guia.litros);
  const diferenciaLitros = Math.abs(numero(detalle.volumen) - litrosGuia);

  if (diferenciaLitros > 0.01) {
    throw new Error(
      `Los litros de En Ruta (${detalle.volumen}) no coinciden con los ${litrosGuia} litros enteros de la guía Coseducam.`
    );
  }
}

async function confirmarGuiaCoseducam(request) {
  const guiaId = String(request.body?.guiaId || "").trim();

  if (!guiaId) {
    const error = new Error("Falta identificar la guía Coseducam a confirmar.");
    error.status = 400;
    throw error;
  }

  const { data: guia, error: errorGuia } = await supabaseAdmin
    .from("coseducam_guias")
    .select(
      "id, fecha, codigo_eds, rut_cliente, litros, estado, numero_guia, codigo_autorizacion"
    )
    .eq("id", guiaId)
    .maybeSingle();

  if (errorGuia) {
    throw new Error(`No se pudo leer la guía Coseducam: ${errorGuia.message}`);
  }

  if (!guia) {
    const error = new Error("La guía Coseducam indicada no existe.");
    error.status = 404;
    throw error;
  }

  if (guia.estado === "confirmada") {
    return {
      fecha: guia.fecha,
      numeroGuia: guia.numero_guia,
      yaConfirmada: true,
      mensaje: "La guía ya estaba confirmada en Copec en Ruta.",
    };
  }

  if (guia.estado !== "creada") {
    const error = new Error(
      `La guía se encuentra en estado ${guia.estado} y no puede confirmarse.`
    );
    error.status = 409;
    throw error;
  }

  if (
    normalizarRut(guia.rut_cliente) !== RUT_COSEDUCAM ||
    !guia.numero_guia ||
    !guia.codigo_autorizacion
  ) {
    const error = new Error(
      "La guía guardada no contiene la identificación completa de Coseducam."
    );
    error.status = 409;
    throw error;
  }

  const numeroGuia = String(guia.numero_guia).trim();
  const codigoEds = String(guia.codigo_eds).trim();
  const pedido = await buscarPedidoEnRuta({ numeroGuia, codigoEds });
  const numeroPedido = String(pedido.NUMEROPEDIDO).trim();
  const detalle = await obtenerDetallePedidoEnRuta(numeroPedido);

  validarPedidoCoseducam({ guia, pedido, detalle });

  // Este es el unico llamado que modifica Copec en Ruta. No se reintenta
  // automaticamente para evitar confirmar dos veces ante una respuesta dudosa.
  const textoConfirmacion = await solicitarMonitorEntregaEnRuta(
    new URLSearchParams({
      accion: "modificarPedido",
      codclie: detalle.codigoCliente,
      codauto: detalle.codigoAutorizacion,
      comuna: detalle.comuna,
      flete: String(detalle.flete),
      desinta: detalle.responsable,
      despro: "DIESEL",
      direccion: detalle.direccion,
      fechaauto: detalle.fechaAutorizacion,
      horaauto: detalle.horaAutorizacion,
      codinsta: detalle.codigoInstalacion,
      pedido: numeroPedido,
      guia: numeroGuia,
      precio: String(detalle.precio),
      codprod: detalle.codigoProducto || "001",
      razon: detalle.razon,
      rut: detalle.rut,
      tarjeta: detalle.tarjeta,
      volumen: String(detalle.volumen),
      tipo: String(process.env.COSEDUCAM_ENRUTA_TIPO || "5"),
      patente: "",
      email: "",
      rutr: "",
    })
  );
  const partesConfirmacion = separarRespuestaEnRuta(textoConfirmacion);

  if (
    partesConfirmacion[0] !== "1" ||
    !normalizarTexto(partesConfirmacion.slice(1).join(" ")).includes(
      "CONFIRMACION EXITOSA"
    )
  ) {
    const error = new Error(
      partesConfirmacion.slice(1).join(" ") ||
        "Copec en Ruta no confirmó la guía."
    );
    error.status = 502;
    throw error;
  }

  const confirmadoEn = new Date().toISOString();
  const respuestaConfirmacion = {
    fuente: "COPEC_EN_RUTA",
    cliente: { rut: detalle.rut, razonSocial: detalle.razon },
    pedido: numeroPedido,
    guia: numeroGuia,
    codigoAutorizacionTctTae: guia.codigo_autorizacion,
    codigoAutorizacionEnRuta: detalle.codigoAutorizacion,
    codigosCoinciden:
      String(guia.codigo_autorizacion || "").trim() ===
      String(detalle.codigoAutorizacion || "").trim(),
    litros: detalle.volumen,
    respuesta: partesConfirmacion.slice(1).join(" "),
    confirmadoEn,
  };
  const mensaje = "Guía Coseducam confirmada correctamente en Copec en Ruta.";
  const { error: errorActualizacion } = await supabaseAdmin
    .from("coseducam_guias")
    .update({
      estado: "confirmada",
      mensaje,
      respuesta_confirmacion: respuestaConfirmacion,
      confirmada_en: confirmadoEn,
      sincronizado_en: confirmadoEn,
    })
    .eq("id", guia.id);

  if (errorActualizacion) {
    throw new Error(
      `La guía fue confirmada en En Ruta, pero no pudo registrarse en VALEPAC Connect: ${errorActualizacion.message}`
    );
  }

  return {
    fecha: guia.fecha,
    numeroGuia,
    numeroPedido,
    mensaje,
  };
}

export async function guardarVentas(filas, opciones = {}) {
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
    // Regla Muevo Empresa: usar solo el campo `total` de la linea oficial.
    // Los demás totales y la propina se conservan dentro del JSON original,
    // pero no participan en este cálculo.
    const monto = numero(fila.total ?? fila.montoBruto ?? fila.monto);

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
        montoBruto: monto,
        montoConciliable: monto,
        campoMontoConciliacion: "total",
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
      (total, venta) => total + numero(venta.monto),
      0
    ),
    totalPropinas: 0,
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

export function adaptarVentaCopecFuel(fila, fecha, ubicacion) {
  return {
    transaccionId: fila.transaccionId,
    transaccionCodigo: fila.transaccionCodigo,
    codigoEds: fila.codigoEds || ubicacion.codigo || null,
    fecha,
    rutEmisor: fila.clienteRut,
    razonSocialEmisor: fila.clienteRazonSocial,
    formaPago: fila.formaPagoNombre || fila.formaPago,
    tipoDocumento: fila.tipoDocumento,
    descripcionDocumento: fila.descripcionDocumento,
    folio: fila.folio,
    total: numero(fila.total),
    montoBruto: numero(fila.total),
    fuente: "api_oficial_venta_combustible",
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

  const ventasOficiales = await obtenerVentasOficialesCopecFuel(fecha);
  // Muevo Empresa y Recompra conservan su universo de combustible. Las
  // ventas de productos se incorporan solamente al resumen CopecFuel y a la
  // conciliacion general de abonos.
  const filasDetalle = ventasOficiales.filasCombustible;
  const ubicacion = {
    codigo: ventasOficiales.codigoEds,
    ubicacionId: ventasOficiales.clienteId,
  };

  const filas = filasDetalle.map((fila) =>
    adaptarVentaCopecFuel(fila, fecha, ubicacion)
  );
  const resultado = await guardarVentas(filas, {
    reemplazarFecha: fecha,
    codigoEds: ubicacion.codigo || null,
    permitirVacio: true,
  });
  let resultadoLake;

  try {
    resultadoLake = await sincronizarM2LakeDia(fecha);
  } catch (errorLake) {
    console.error("No se pudo actualizar Data Lake durante la sincronizacion Recompra:", errorLake);
    resultadoLake = {
      fecha,
      actualizado: false,
      error: errorLake instanceof Error ? errorLake.message : "Error desconocido",
    };
  }

  let resultadoPoa;

  try {
    resultadoPoa = await guardarVolumenesPoaCopecFuel(filasDetalle, {
      fecha,
      codigoEds: ubicacion.codigo || null,
    });
  } catch (errorPoa) {
    console.error("No se pudo alimentar POA Volumenes:", errorPoa);
    resultadoPoa = {
      actualizado: false,
      error: errorPoa instanceof Error ? errorPoa.message : "Error desconocido",
    };
  }

  return {
    fecha,
    estacion: ubicacion.codigo || ubicacion.ubicacionId,
    fuente: "API_OFICIAL_VENTA_COMBUSTIBLE",
    paginasConsultadas: 1,
    registrosDetalle: filasDetalle.length,
    diagnostico: ventasOficiales.diagnostico,
    ...resultado,
    ventasRecompraGuardadas: Number(resultadoLake?.recompraLake?.lineas || 0),
    montoRecompraGuardado: Number(resultadoLake?.recompraLake?.montoVentaReferencia || 0),
    recompraLake: resultadoLake?.recompraLake || {
      actualizado: false,
      error: resultadoLake?.error || "Data Lake no informo estado Recompra.",
    },
    m2Lake: resultadoLake,
    poa: resultadoPoa,
  };
}

function separarTsv(texto) {
  const lineas = String(texto || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((linea) => linea.trim());

  if (lineas.length < 2) return [];

  const encabezados = lineas[0].split("\t").map(normalizarTexto);

  return lineas.slice(1).map((linea) => {
    const valores = linea.split("\t");
    return Object.fromEntries(
      encabezados.map((encabezado, indice) => [
        encabezado,
        String(valores[indice] ?? "").trim(),
      ])
    );
  });
}

function validarSolicitudExcelEnRuta({ fechaDesde, fechaHasta, codigoEds }) {
  if (!fechaDesde || !fechaHasta) {
    const error = new Error("Indica una fecha desde y una fecha hasta validas.");
    error.status = 400;
    throw error;
  }

  if (fechaDesde > fechaHasta) {
    const error = new Error(
      "La fecha desde no puede ser posterior a la fecha hasta."
    );
    error.status = 400;
    throw error;
  }

  if (!/^\d{4,6}$/.test(codigoEds)) {
    const error = new Error(
      "El codigo de estacion debe contener entre 4 y 6 numeros."
    );
    error.status = 400;
    throw error;
  }

  const milisegundosDia = 24 * 60 * 60 * 1000;
  const diasSolicitados =
    Math.round(
      (Date.parse(`${fechaHasta}T00:00:00Z`) -
        Date.parse(`${fechaDesde}T00:00:00Z`)) /
        milisegundosDia
    ) + 1;

  if (!Number.isFinite(diasSolicitados) || diasSolicitados > 366) {
    const error = new Error(
      "El rango del reporte no puede superar los 366 dias."
    );
    error.status = 400;
    throw error;
  }
}

async function obtenerExcelEnRuta({ fechaDesde, fechaHasta, codigoEds }) {
  const desde = normalizarFecha(fechaDesde);
  const hasta = normalizarFecha(fechaHasta);
  const estacion = String(codigoEds || "").trim();

  validarSolicitudExcelEnRuta({
    fechaDesde: desde,
    fechaHasta: hasta,
    codigoEds: estacion,
  });

  const body = new URLSearchParams({
    accion: "infoExcel",
    hr: "",
    pedido: "",
    destinatario: "",
    estacion,
    tipo: "0",
    estado: "0",
    guia: "",
    fini: fechaChilena(desde),
    ffini: fechaChilena(hasta),
    usuario: estacion,
  });
  const respuestaGeneracion = await fetch(
    `${ENRUTA_BASE_URL}/fetch/elementos/f_MonitorPedido.aspx`,
    {
      method: "POST",
      headers: {
        Accept: "text/html, */*; q=0.01",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Origin: ENRUTA_BASE_URL,
        Referer: `${ENRUTA_BASE_URL}/MonitorPedido.aspx`,
        "X-Requested-With": "XMLHttpRequest",
      },
      body: body.toString(),
    }
  );
  const respuestaTexto = await respuestaGeneracion.text();
  const nombreArchivo = respuestaTexto.match(/Excel_[0-9A-Za-z]+/)?.[0];

  if (!respuestaGeneracion.ok || !nombreArchivo) {
    throw new Error(
      `Copec en Ruta no pudo generar el detalle (estado ${respuestaGeneracion.status}).`
    );
  }

  const respuestaArchivo = await fetch(
    `${ENRUTA_BASE_URL}/pdf/${nombreArchivo}.xls`,
    {
      headers: {
        Accept: "application/vnd.ms-excel, text/plain, */*",
        Referer: `${ENRUTA_BASE_URL}/MonitorPedido.aspx`,
      },
    }
  );

  if (!respuestaArchivo.ok) {
    throw new Error(
      `Copec en Ruta no pudo descargar el detalle (estado ${respuestaArchivo.status}).`
    );
  }

  return {
    bytes: await respuestaArchivo.arrayBuffer(),
    nombreArchivo: `${nombreArchivo}.xls`,
    fechaDesde: desde,
    fechaHasta: hasta,
    codigoEds: estacion,
  };
}

async function sincronizarVolumenPropioEnRuta(request) {
  const periodo = String(
    request.body?.periodo || request.query?.periodo || ""
  ).trim();
  const rango = rangoMes(periodo);

  if (!rango) {
    const error = new Error("El periodo debe usar el formato AAAA-MM.");
    error.status = 400;
    throw error;
  }

  // Volumen Propio puede cambiar retroactivamente: un pedido que un día figura
  // NO ENTREGADO puede reprogramarse y luego quedar ENTREGADO conservando una
  // FECHA ESTADO anterior a la fecha desde la que el usuario sincroniza el portal.
  // Por eso este origen se reconstruye siempre desde el primer día del mes.
  const desdeSincronizacion = rango.desde;

  const codigoEds = String(
    request.body?.codigoEds ||
      process.env.ENRUTA_EDS ||
      process.env.COPEC_EDS_PRECIOS ||
      (process.env.COPEC_ID_EDS !== "*" ? process.env.COPEC_ID_EDS : "") ||
      "40098"
  ).trim();
  const { bytes } = await obtenerExcelEnRuta({
    fechaDesde: desdeSincronizacion,
    fechaHasta: rango.hasta,
    codigoEds,
  });
  const texto = new TextDecoder("windows-1252").decode(bytes);
  const filas = separarTsv(texto);
  const registros = new Map();

  for (const fila of filas) {
    const estado = normalizarTexto(fila.ESTADO);
    const tipo = normalizarTexto(fila.TIPO);
    const fecha = normalizarFecha(fila["FECHA ESTADO"]);
    const producto = clasificarProductoEnRuta(fila.PRODUCTO);
    const litros = numeroChile(fila["LITROS ENTREGADOS"]);

    if (
      !["CERRADO", "ENTREGADO"].includes(estado) ||
      tipo !== "CONCESIONARIO" ||
      !fecha ||
      fecha < desdeSincronizacion ||
      !producto ||
      litros <= 0
    ) {
      continue;
    }

    const identificador = [
      "enruta-volumen-propio-v2",
      codigoEds,
      fila["NUMERO PEDIDO"],
      fila["HOJA RUTA"],
      fila.DTE,
      fecha,
      producto,
      litros.toFixed(3),
    ].join("|");
    registros.set(identificador, {
      identificador_origen: identificador,
      fecha,
      codigo_eds: codigoEds,
      tipo: "volumen_propio",
      producto,
      litros,
      referencia: fila.DTE || fila["NUMERO PEDIDO"] || null,
      descripcion: `Volumen Propio ${fila.DESTINATARIO || "Copec en Ruta"}`,
      fuente: "copec_en_ruta",
      datos_origen: fila,
      sincronizado_en: new Date().toISOString(),
    });
  }

  const { error: errorLimpieza } = await supabaseAdmin
    .from("recompra_ajustes")
    .delete()
    .eq("tipo", "volumen_propio")
    .eq("codigo_eds", codigoEds)
    .gte("fecha", desdeSincronizacion)
    .lte("fecha", rango.hasta);

  if (errorLimpieza) {
    throw new Error(
      `No se pudo actualizar Volumen Propio: ${errorLimpieza.message}`
    );
  }

  const volumenes = [...registros.values()];

  if (volumenes.length > 0) {
    const { error } = await supabaseAdmin
      .from("recompra_ajustes")
      .upsert(volumenes, { onConflict: "identificador_origen" });

    if (error) {
      throw new Error(`No se pudo guardar Volumen Propio: ${error.message}`);
    }
  }

  let resultadoPoa;

  try {
    resultadoPoa = await guardarVolumenesPoaEnRuta(filas, {
      fechaDesde: desdeSincronizacion,
      fechaHasta: rango.hasta,
      codigoEds,
    });
  } catch (errorPoa) {
    console.error("No se pudo alimentar POA desde En Ruta:", errorPoa);
    resultadoPoa = {
      actualizado: false,
      error: errorPoa instanceof Error ? errorPoa.message : "Error desconocido",
    };
  }

  return {
    periodo,
    fechaDesde: desdeSincronizacion,
    estacion: codigoEds,
    filasDescargadas: filas.length,
    entregasGuardadas: volumenes.length,
    litrosVolumenPropio: volumenes.reduce(
      (total, registro) => total + numero(registro.litros),
      0
    ),
    poa: resultadoPoa,
  };
}

async function guardarAjusteTctTae(request) {
  const fecha = normalizarFecha(request.body?.fecha);
  const litros = numeroChile(request.body?.litros);
  const referencia = String(request.body?.referencia || "").trim();
  const codigoEds = String(
    request.body?.codigoEds ||
      process.env.COPEC_EDS_PRECIOS ||
      (process.env.COPEC_ID_EDS !== "*" ? process.env.COPEC_ID_EDS : "") ||
      "40098"
  ).trim();

  if (!fecha || litros === 0) {
    const error = new Error(
      "Indica una fecha valida y una cantidad de litros distinta de cero."
    );
    error.status = 400;
    throw error;
  }

  const identificador = [
    "tct-tae-manual-v1",
    codigoEds,
    fecha,
    normalizarTexto(referencia || "SIN REFERENCIA"),
    litros.toFixed(3),
  ].join("|");
  const { data, error } = await supabaseAdmin
    .from("recompra_ajustes")
    .upsert(
      {
        identificador_origen: identificador,
        fecha,
        codigo_eds: codigoEds,
        tipo: "tct_tae_manual",
        producto: "DIESEL",
        litros,
        referencia: referencia || null,
        descripcion: "TCT/TAE no rescatado en surtidor validador",
        fuente: "ingreso_manual",
        datos_origen: {
          regla: "Solo Diesel; acepta litros positivos o negativos y el valor se calcula con el precio costo vigente respetando el signo.",
        },
        sincronizado_en: new Date().toISOString(),
      },
      { onConflict: "identificador_origen" }
    )
    .select("id, fecha, producto, litros, referencia, descripcion")
    .single();

  if (error) {
    throw new Error(`No se pudo guardar el ajuste TCT/TAE: ${error.message}`);
  }

  return data;
}

async function eliminarAjusteTctTae(request) {
  const id = String(request.body?.id || "").trim();

  if (!id) {
    const error = new Error("Falta identificar el ajuste TCT/TAE.");
    error.status = 400;
    throw error;
  }

  const { error } = await supabaseAdmin
    .from("recompra_ajustes")
    .delete()
    .eq("id", id)
    .eq("tipo", "tct_tae_manual");

  if (error) {
    throw new Error(`No se pudo eliminar el ajuste TCT/TAE: ${error.message}`);
  }

  return { id };
}


// -----------------------------------------------------------------------------
// COSEDUCAM V2: un solo motor para botones PWA y el futuro worker.
// FLAGS DE EMISION DESACTIVADAS POR DEFECTO. No hay un modo de litros ficticios.
// -----------------------------------------------------------------------------
const ACCIONES_COSEDUCAM_V2 = new Set([
  "coseducam_v2_consultar",
  "coseducam_v2_preflight_tae",
  "coseducam_v2_actualizar",
  "coseducam_v2_crear_tae",
  "coseducam_v2_confirmar_enruta",
]);

function relojOperacionChile() {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const valor = (tipo) => partes.find((p) => p.type === tipo)?.value;
  const fecha = `${valor("year")}-${valor("month")}-${valor("day")}`;
  return { fecha, fechaHora: `${fecha}T${valor("hour")}:${valor("minute")}:${valor("second")}` };
}

function secretoWorkerValido(request) {
  const secreto = process.env.COSEDUCAM_WORKER_SECRET;
  const recibido = request.headers?.["x-valepac-worker-secret"];
  if (typeof secreto !== "string" || !secreto || typeof recibido !== "string" || !recibido) {
    return false;
  }
  const hash = (valor) => createHash("sha256").update(valor).digest();
  return timingSafeEqual(hash(recibido), hash(secreto));
}

function hayCabeceraWorker(request) {
  return Object.keys(request.headers || {}).some((k) => k.toLowerCase() === "x-valepac-worker-secret");
}

function errorOperacionV2(mensaje, status = 409, code = "COSEDUCAM_V2_BLOQUEADA") {
  const error = new Error(mensaje);
  error.status = status;
  error.code = code;
  return error;
}

async function rpcCoseducamV2(nombre, argumentos) {
  const { data, error } = await supabaseAdmin.rpc(nombre, argumentos);
  if (error) throw errorOperacionV2(`Control ${nombre} no disponible. No se ejecutó emisión.`, 503, "COSEDUCAM_RPC_NO_DISPONIBLE");
  if (!data || typeof data !== "object") throw errorOperacionV2(`Respuesta insegura de ${nombre}.`, 503);
  return data;
}

async function consultarCoseducamV2(fecha) {
  const ventas = await leerTabla(
    "coseducam_consumos",
    "fecha, codigo_eds, transaccion_id, transaccion_codigo, producto, litros, precio_unitario, fecha_cierre_copec, fecha_cierre_copec_raw",
    fecha, fecha,
  );
  const detalle = clasificarConsumosV2(fecha, ventas);
  // El resumen de Supabase es la validación oficial, no el cálculo del navegador.
  let comercial = null;
  if (fecha >= "2026-10-14") {
    comercial = await rpcCoseducamV2("coseducam_resumen_comercial_v2", { p_fecha: fecha });
    if (comercial.ok !== detalle.completo ||
        comercial.registrosIncluidos !== detalle.registros ||
        Math.round(Number(comercial.litros) * 1000) / 1000 !== detalle.litros ||
        (comercial.precioMaximoTae === null ? null : Number(comercial.precioMaximoTae)) !== detalle.precioTae) {
      // Diferencia de datos comerciales: no la ocultaríamos con un fallback.
      return { fecha, ok: false, estado: "DATOS_NO_COINCIDEN",
        detalle: { litros: detalle.litros, registros: detalle.registros },
        emisionHabilitada: false, confirmacionHabilitada: false };
    }
  }
  return {
    fecha, ok: true, estado: detalle.historico ? "HISTORICO_SOLO_CONSULTA" :
      detalle.completo ? "DATOS_COMERCIALES_VALIDOS" : "DATOS_PENDIENTES_O_INVALIDOS",
    historicoSoloConsulta: detalle.historico,
    litros: detalle.litros, registros: detalle.registros,
    precioTae: detalle.precioTae, excluidos: detalle.registrosExcluidos,
    invalidos: detalle.invalidos.length, datosCompletos: detalle.completo,
    fechaCorte: detalle.fechaCorte,
    comercial,
    sincronizacionEjecutada: false, // no finge importar ni altera Data Lake
    emisionHabilitada: false, confirmacionHabilitada: false,
  };
}

// Estado preoperacional de solo lectura: no reserva, prepara ni emite.
// Acredita separadamente flags del deployment, reloj del servidor y SQL.
async function diagnosticarHabilitacionCoseducamV2(fecha) {
  const reloj = relojOperacionChile();
  const horaChile = reloj.fechaHora.slice(11);
  const flagTae = process.env.COSEDUCAM_TAE_V2_HABILITADA === "true";
  const flagEnRuta = process.env.COSEDUCAM_ENRUTA_V2_HABILITADA === "true";
  const comercial = await rpcCoseducamV2("coseducam_resumen_comercial_v2", { p_fecha: fecha });
  const cierre = await rpcCoseducamV2("coseducam_control_cierre_v1", { p_fecha: fecha });
  let preparacion = null;
  // p_guardar=false es lectura. Antes del corte no hace falta consultar preparación.
  if (fecha === reloj.fecha && horaChile >= "23:50:00" && flagTae &&
      comercial.ok === true && cierre.ok === true) {
    preparacion = await rpcCoseducamV2("coseducam_preparar_v2", {
      p_fecha: fecha, p_guardar: false,
    });
  }
  const evaluacion = evaluarEstadoTaeV2({
    fecha, fechaChile: reloj.fecha, horaChile, flagTae, comercial, cierre, preparacion,
  });
  return {
    estado: evaluacion.listoParaSolicitarTae ? "PREVALIDACION_LISTA" : "PREVALIDACION_BLOQUEADA",
    fecha, servidorFechaChile: reloj.fecha, servidorHoraChile: horaChile,
    versionDiagnostico: "2026-10-22.1-preflight-tae-sin-escrituras",
    emisionTaeDisponible: flagTae,
    confirmacionEnRutaDisponible: flagEnRuta,
    datosComerciales: {
      estado: comercial.estado || null,
      validos: comercial.ok === true,
      litros: Number(comercial.litros || 0),
      precioMaximoTae: comercial.precioMaximoTae ?? null,
      registros: Number(comercial.registrosIncluidos || 0),
    },
    controlCierre: {
      estado: cierre.estado || null,
      acreditado: cierre.ok === true,
      capturadoEn: cierre.capturadoEn || null,
      procesadoEn: cierre.procesadoEn || null,
      lineasDataLake: cierre.lineasDataLake ?? null,
    },
    preparacion: preparacion ? { estadoControl: preparacion.estadoControl || null } : null,
    ...evaluacion,
    modificoDatos: false,
    emisionEjecutada: false,
    confirmacionEjecutada: false,
  };
}

// La actualización es explícita: NO es una lectura del caché ni una emisión.
// Usan esta misma operación PWA y worker. Solo se admite el día actual.
async function actualizarLakeCoseducamV2(fecha, cierreRunId = null) {
  const hoy = relojOperacionChile().fecha;
  if (fecha !== hoy || fecha < "2026-10-15") {
    throw errorOperacionV2("Solo se permite actualizar la fecha operacional actual.", 409, "COSEDUCAM_FECHA_NO_ACTUALIZABLE");
  }
  // Un cierre automático ya iniciado congela el día para los botones PWA.
  // Solo el worker que posee el runId de la fila EJECUTANDO puede completar SU captura.
  const {data: cierre, error: cierreError} = await supabaseAdmin
    .from("coseducam_cierres_v2")
    .select("run_id,estado")
    .eq("fecha",fecha).eq("codigo_eds","40098").maybeSingle();
  if (cierreError) throw errorOperacionV2(
    "Control persistente de cierre no disponible; actualización bloqueada.",503);
  const runIdValido = typeof cierreRunId === "string" &&
    /^[0-9a-f-]{36}$/i.test(cierreRunId);
  if (cierre) {
    if (!runIdValido || cierre.run_id !== cierreRunId || cierre.estado !== "EJECUTANDO") {
      throw errorOperacionV2(
        "Ya se inició el cierre diario COSEDUCAM. No actualizar desde la PWA.",
        409,"COSEDUCAM_CIERRE_YA_INICIADO");
    }
  } else if (cierreRunId) {
    throw errorOperacionV2("No existe reserva de cierre válida.",409);
  }
  // Una guía/preparación/job congela el día para no invalidar la evidencia TAE.
  for (const tabla of ["coseducam_preparaciones", "coseducam_jobs", "coseducam_guias"]) {
    const {data, error} = await supabaseAdmin.from(tabla)
      .select("id").eq("fecha", fecha).eq("codigo_eds", "40098").limit(1);
    if (error) throw errorOperacionV2(`No se pudo verificar ${tabla}; actualización bloqueada.`, 503);
    if (data?.length) throw errorOperacionV2(
      "Este día ya tiene preparación, trabajo o guía TAE. No se permite actualizar sus consumos.",
      409, "COSEDUCAM_DIA_CERRADO");
  }
  // Hace nueva captura API CopecFuel → archivado JSON.gz → procesamiento conjunto.
  const resultado = await sincronizarM2LakeDia(fecha, {cierreRunId});
  if (resultado.recompraLake?.actualizado !== true ||
      !Number.isFinite(resultado.registros) || resultado.registros <= 0 ||
      !resultado.sha256 || !resultado.capturadoEn || !resultado.procesadoEn) {
    throw errorOperacionV2("La actualización no confirmó M2/Recompra/COSEDUCAM.", 503);
  }
  const {data: estado, error} = await supabaseAdmin.from("recompra_estado_diario")
    .select("estado,coseducam_lineas,sha256,capturado_en,procesado_en")
    .eq("fecha", fecha).single();
  if (error || !estado || estado.estado !== "PROCESADO" ||
      estado.sha256 !== resultado.sha256 ||
      Number(estado.coseducam_lineas) !== Number(resultado.recompraLake.coseducamLineas)) {
    throw errorOperacionV2("La captura no coincide con el estado PostgreSQL; no continuar a TAE.", 503);
  }
  const comercial = await consultarCoseducamV2(fecha);
  if (comercial.ok !== true) throw errorOperacionV2("La lectura comercial no coincide con SQL V2.", 503);
  return {
    estado: "DATA_LAKE_ACTUALIZADO", fecha,
    fuente: "COPECFUEL_API_ARCHIVE_PROCESS",
    sincronizacionEjecutada: true,
    capturadoEn: estado.capturado_en,
    procesadoEn: estado.procesado_en,
    sha256: estado.sha256,
    transaccionesCombustible: resultado.registros,
    lineasCoseducam: Number(estado.coseducam_lineas),
    resumenComercial: comercial,
    emisionHabilitada: false, confirmacionHabilitada: false,
  };
}

// Autorización externa: solo UN POST, incluidos rechazos 401/403.
// No utilizar solicitarTctTae() en este punto: ese helper reintenta ante 401/403.
async function autorizarTaeCoseducamUnaVez(payload) {
  let token = obtenerTokenCopecActual();
  if (!token) token = (await iniciarSesionCopec()).accessToken;
  const respuesta = await fetch(`${TCT_TAE_BASE_URL}/autorizar-consumo`, {
    method: "POST",
    headers: {
      Accept: "application/json", Origin: "https://tct-tae.copec.cl",
      Referer: "https://tct-tae.copec.cl/", token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const texto = await respuesta.text();
  let json;
  try { json = JSON.parse(texto); } catch { throw Error("TAE respondió formato inesperado."); }
  if (!respuesta.ok || json?.data?.error !== "") {
    throw Error(`TAE no acreditó autorización (HTTP ${respuesta.status}). Revisión obligatoria.`);
  }
  const numero = String(json?.data?.numero_guia || "").trim();
  const autorizacion = String(json?.data?.codigo_autorizacion || "").trim();
  if (!numero || !autorizacion) throw Error("TAE no acreditó número y código de autorización.");
  return { numero, autorizacion, mensaje: String(json.data.mensaje || "Autorizada").slice(0, 250) };
}

async function crearTaeCoseducamV2(fecha) {
  const reloj = relojOperacionChile();
  if (debeBloquearEmisionV2({
    fecha, hoyChile: reloj.fecha, ahoraChile: reloj.fechaHora,
    flag: process.env.COSEDUCAM_TAE_V2_HABILITADA === "true",
  })) throw errorOperacionV2(
    "TAE V2 no habilitada o fecha fuera del corte operacional. Históricos solo consulta.",
    423, "COSEDUCAM_TAE_DESACTIVADA",
  );

  // El cierre, las cifras y el snapshot deben validarse en PostgreSQL.
  // IMPORTANTE: no habilitar este flag hasta acreditar CopecFuel completo.
  const preview = await rpcCoseducamV2("coseducam_preparar_v2", {p_fecha: fecha, p_guardar: false});
  if (!["PREPARADA", "LISTA_PARA_PREPARAR"].includes(preview.estadoControl)) {
    throw errorOperacionV2(`Preparación bloqueada: ${preview.estadoControl}`);
  }
  const preparado = preview.estadoControl === "PREPARADA" ? preview :
    await rpcCoseducamV2("coseducam_preparar_v2", {p_fecha: fecha, p_guardar: true});
  if (preparado.estadoControl !== "PREPARADA" || !preparado.controlCierre?.ok) {
    throw errorOperacionV2("No se acreditó preparación y cierre del Data Lake.");
  }

  // Lecturas de configuración TAE ANTES de consumir el único intento externo.
  const configuracion = await obtenerConfiguracionGuiaCoseducam("40098");
  const reserva = await rpcCoseducamV2("coseducam_reservar_tae_v2", {
    p_fecha: fecha, p_reservar: true,
  });
  if (reserva.estado !== "TAE_RESERVADA" || reserva.reservado !== true || !reserva.jobId) {
    throw errorOperacionV2(`Reserva TAE rechazada: ${reserva.estado || "sin estado"}`);
  }
  const jobId = reserva.jobId;
  const iniciado = await rpcCoseducamV2("coseducam_iniciar_tae_v2", {
    p_job_id: jobId, p_iniciar: true,
  });
  if (iniciado.estado !== "TAE_ENVIO_INICIADO" || iniciado.autorizado !== true ||
      iniciado.jobId !== jobId || Number(iniciado.litrosGuia) !== Number(reserva.litrosGuia) ||
      Number(iniciado.precioAplicado) !== Number(reserva.precioTae)) {
    throw errorOperacionV2("Reserva de TAE no pudo consumirse de forma segura; intervención humana.");
  }

  // A partir de aquí la solicitud podría haber llegado a Copec.
  // Toda falla o respuesta desconocida BLOQUEA el reenvío automático.
  let autorizado;
  try {
    const precio = Number(iniciado.precioAplicado);
    const litros = Number(iniciado.litrosGuia);
    if (!Number.isSafeInteger(precio) || !Number.isSafeInteger(litros) || precio <= 0 || litros <= 0) {
      throw Error("Precio o litros no compatibles con TAE.");
    }
    autorizado = await autorizarTaeCoseducamUnaVez({
      id_eds: "40098", codigo_cliente: String(parseInt(configuracion.cliente.codigo_sin_digito, 10)),
      numero_tarjeta: configuracion.tarjeta.numero_tarjeta, cod_producto: "001", precio,
      rut: process.env.COPEC_RUT_CONCESIONARIO || "78229820-8",
      nombre_rut: process.env.COPEC_NOMBRE_CONCESIONARIO || "VALENCIA Y PACHECO LTDA.",
      cod_motivo: "0002", monto: Math.ceil(litros * precio), unidad: litros.toFixed(2),
      cod_subproducto: "001", direccion: process.env.COSEDUCAM_DIRECCION || "fuenzalida 31",
      cod_comuna: process.env.COSEDUCAM_COD_COMUNA || "13501",
      flete: Math.round(configuracion.flete), orden_compra: "",
      comuna: process.env.COSEDUCAM_COMUNA || "Melipilla", tae_retiro: false,
    });
  } catch (error) {
    try { await rpcCoseducamV2("coseducam_registrar_tae_v2", {
      p_job_id: jobId, p_resultado: "INCIERTA", p_mensaje: String(error?.message || "Respuesta incierta").slice(0, 300),
    }); } catch { /* Ya tiene intentos_tae=1; no reenviar aunque falle el registro. */ }
    throw errorOperacionV2("Resultado TAE incierto. No reintentar; revisar directamente en Copec.", 409, "COSEDUCAM_TAE_INCIERTA");
  }
  const registro = await rpcCoseducamV2("coseducam_registrar_tae_v2", {
    p_job_id: jobId, p_resultado: "AUTORIZADA", p_numero_guia: autorizado.numero,
    p_codigo_autorizacion: autorizado.autorizacion, p_mensaje: autorizado.mensaje,
  });
  if (!registro.ok || registro.estado !== "ESPERANDO_ENRUTA") {
    throw errorOperacionV2("Copec autorizó TAE, pero el registro local requiere revisión. No reintentar.", 409);
  }
  return { estado: "ESPERANDO_ENRUTA", numeroGuia: autorizado.numero,
    litros: iniciado.litrosGuia, precioAplicado: iniciado.precioAplicado,
    jobId, mensaje: "TAE registrada; pendiente de En Ruta." };
}

async function confirmarEnRutaCoseducamV2(fecha, guiaId) {
  const hoy = relojOperacionChile().fecha;
  if (process.env.COSEDUCAM_ENRUTA_V2_HABILITADA !== "true")
    throw errorOperacionV2("En Ruta V2 permanece desactivada.", 423, "COSEDUCAM_ENRUTA_DESACTIVADA");
  if (fecha < "2026-10-15" || fecha > hoy || !guiaId)
    throw errorOperacionV2("Fecha o guía no autorizada.");
  const { data: guia, error: errorGuia } = await supabaseAdmin
    .from("coseducam_guias").select("id,fecha,codigo_eds,numero_guia,estado")
    .eq("id", guiaId).eq("fecha", fecha).eq("codigo_eds", "40098").maybeSingle();
  if (errorGuia || !guia || guia.estado !== "creada" || !guia.numero_guia)
    throw errorOperacionV2("La guía no está lista para confirmar.");
  // Claim atómico del ÚNICO intento destructivo En Ruta: workers y PWA
  // comparten exactamente este compare-and-set del job.
  const { data: claims, error: claimError } = await supabaseAdmin
    .from("coseducam_jobs")
    .update({ estado: "confirmando_enruta", etapa_previa: "enruta_envio_iniciado", intentos_enruta: 1,
      actualizado_en: new Date().toISOString() })
    .eq("fecha", fecha).eq("codigo_eds", "40098")
    .eq("estado", "esperando_enruta").eq("etapa_previa", "tae_registrada")
    .eq("intentos_enruta", 0).eq("numero_guia", guia.numero_guia)
    .select("id,numero_guia");
  if (claimError || !Array.isArray(claims) || claims.length !== 1)
    throw errorOperacionV2("No se autorizó un nuevo intento En Ruta. Revisión manual obligatoria.");
  const jobId = claims[0].id;
  try {
    const resultado = await confirmarGuiaCoseducam({body:{guiaId}});
    const { data: confirmado, error: errorJob } = await supabaseAdmin
      .from("coseducam_jobs")
      .update({ estado: "confirmada", etapa_previa: "enruta_confirmada",
        confirmado_en: new Date().toISOString(), actualizado_en: new Date().toISOString() })
      .eq("id", jobId).eq("estado", "confirmando_enruta").eq("intentos_enruta", 1)
      .select("id");
    if (errorJob || !Array.isArray(confirmado) || confirmado.length !== 1)
      throw Error("En Ruta confirmó, pero no se acreditó el cambio de estado del trabajo.");
    return { ...resultado, estado: "CONFIRMADA", jobId };
  } catch (error) {
    await supabaseAdmin.from("coseducam_jobs")
      .update({estado: "revision_requerida", etapa_previa:"enruta_resultado_incierto",
        ultimo_error: String(error?.message || "Resultado En Ruta incierto").slice(0, 500),
        actualizado_en: new Date().toISOString()})
      .eq("id",jobId).eq("estado","confirmando_enruta");
    throw errorOperacionV2("Resultado En Ruta no acreditado. No reintentar automáticamente; revisar en Copec.");
  }
}

async function manejarOperacionCoseducamV2(request, response) {
  const accion = request.body?.accion;
  if (request.method !== "POST" || !ACCIONES_COSEDUCAM_V2.has(accion)) return false;
  response.setHeader("Cache-Control", "private, no-store");
  if (hayCabeceraWorker(request)) {
    if (!secretoWorkerValido(request)) {
      response.status(401).json({ok:false, error:"Worker no autorizado."});
      return true;
    }
  } else {
    const acceso = await requireCoseducam(request, response);
    if (!acceso) return true;
  }
  const fecha = request.body?.fecha;
  if (typeof fecha !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) ||
      request.body?.codigoEds && request.body.codigoEds !== "40098") {
    response.status(400).json({ok:false,error:"Fecha o EDS no válida."});
    return true;
  }
  try {
    let datos;
    if (accion === "coseducam_v2_consultar") datos = await consultarCoseducamV2(fecha);
    else if (accion === "coseducam_v2_preflight_tae") datos = await diagnosticarHabilitacionCoseducamV2(fecha);
    else if (accion === "coseducam_v2_actualizar") datos = await actualizarLakeCoseducamV2(
      fecha, hayCabeceraWorker(request) ? request.body?.cierreRunId : null);
    else if (accion === "coseducam_v2_crear_tae") datos = await crearTaeCoseducamV2(fecha);
    else datos = await confirmarEnRutaCoseducamV2(fecha, request.body?.guiaId);
    response.status(datos.ok === false ? 409 : 200).json({ok: datos.ok !== false, flujo:"COSEDUCAM_V2", ...datos});
  } catch (error) {
    response.status(error.status || 503).json({ok:false, flujo:"COSEDUCAM_V2",
      code:error.code || "COSEDUCAM_V2_NO_DISPONIBLE", error:error.message || "Operación bloqueada."});
  }
  return true;
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "private, no-store");

  // PWA y futuro worker llaman al MISMO motor V2, antes de rutas legacy.
  if (await manejarOperacionCoseducamV2(request, response)) return;
  if (await manejarPreparacionWorker(request, response, { supabaseAdmin })) return;
  const acceso = await requireCoseducam(request, response);

  if (!acceso) return;

  const esOperadorCoseducam = acceso.rol === "operador_coseducam";
  const tipoSolicitado = String(request.query?.tipo || "").trim();
  const accionSolicitada = String(request.body?.accion || "").trim();
  const accionesOperador = new Set([
    "sincronizar_copecfuel",
    "crear_guia_coseducam",
    "confirmar_guia_coseducam",
  ]);

  try {
    if (request.method === "GET" && request.query?.recurso === "sesion_coseducam") {
      return response.status(200).json({
        ok: true,
        usuario: {
          id: acceso.usuario.id,
          email: acceso.usuario.email,
          rol: acceso.rol,
        },
      });
    }

    if (
      esOperadorCoseducam &&
      ((request.method === "GET" && tipoSolicitado !== "coseducam") ||
        (request.method === "POST" && !accionesOperador.has(accionSolicitada)))
    ) {
      return response.status(403).json({
        ok: false,
        code: "COSEDUCAM_SCOPE_FORBIDDEN",
        error: "Esta cuenta solo puede utilizar las funciones de Coseducam.",
      });
    }

    if (request.method === "GET") {
      if (tipoSolicitado === "poa") {
        const resultado = await obtenerPoaAnual(
          request.query?.anio,
          request.query?.codigoEds
        );

        return response.status(200).json({
          ok: true,
          modulo: "POA Volumenes",
          ...resultado,
        });
      }

      const periodo = String(request.query.periodo || "").trim();
      const tipo = String(request.query.tipo || "").trim();
      const esRecompra = tipo === "recompra" || tipo === "recompra_lake";
      const esCoseducam = tipo === "coseducam" || tipo === "coseducam_lake";

      const resultado = esCoseducam
        ? await obtenerMesCoseducamLake(periodo)
        : esRecompra
          ? await obtenerMesRecompraLake(periodo)
          : await obtenerMes(periodo);

      return response.status(200).json({
        ok: true,
        conciliador: esCoseducam
          ? "Coseducam Lake"
          : esRecompra
            ? "Recompra Lake"
            : "Cargos Muevo empresa",
        periodo,
        ...resultado,
        criterio: esCoseducam
          ? "Consumos diésel STORAGE COSEDUCAM hasta las 23:49:59. Precio máximo unitario STORAGE del período elegible; históricos solo consulta."
          : esRecompra
          ? "Abonos Recompra del Portal Copec menos el costo vigente de los litros netos: ventas Recompra - Volumen Propio + fluctuación de VCTG38/VCTG39 + TCT/TAE manual Diésel. BlueMax queda excluido."
          : "Cargos Consumo Muevo Empresa del Portal Copec menos la suma del campo total de las ventas emitidas por Copec pagadas en efectivo, credito o debito.",
      });
    }

    if (request.method === "POST") {
      if (request.body?.accion === "crear_guia_coseducam" ||
          request.body?.accion === "confirmar_guia_coseducam") {
        return response.status(410).json({
          ok:false,code:"COSEDUCAM_LEGACY_DESACTIVADO",
          error:"La emisión antigua fue deshabilitada. Utiliza el motor COSEDUCAM V2.",
        });
      }
      if (request.body?.accion === "descargar_excel_enruta") {
        const archivo = await obtenerExcelEnRuta({
          fechaDesde: request.body?.fechaDesde,
          fechaHasta: request.body?.fechaHasta,
          codigoEds: request.body?.codigoEds,
        });

        response.setHeader("Content-Type", "application/vnd.ms-excel");
        response.setHeader(
          "Content-Disposition",
          `attachment; filename="${archivo.nombreArchivo}"`
        );
        response.setHeader("Content-Length", archivo.bytes.byteLength);

        return response.status(200).send(Buffer.from(archivo.bytes));
      }

      if (request.body?.accion === "sincronizar_enruta") {
        const resultado = await sincronizarVolumenPropioEnRuta(request);

        return response.status(200).json({
          ok: true,
          mensaje: "Volumen Propio sincronizado desde Copec en Ruta.",
          ...resultado,
        });
      }

      if (request.body?.accion === "guardar_tct_tae") {
        const ajuste = await guardarAjusteTctTae(request);

        return response.status(200).json({
          ok: true,
          mensaje: "Ajuste TCT/TAE guardado correctamente.",
          ajuste,
        });
      }

      if (request.body?.accion === "eliminar_tct_tae") {
        const resultado = await eliminarAjusteTctTae(request);

        return response.status(200).json({
          ok: true,
          mensaje: "Ajuste TCT/TAE eliminado.",
          ...resultado,
        });
      }

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
      requiereCapturaEnRuta: Boolean(error?.requiereCapturaEnRuta),
      requiereConfirmacionPrecio: Boolean(error?.requiereConfirmacionPrecio),
      requiereSincronizacionPrecio: Boolean(error?.requiereSincronizacionPrecio),
      precioPortal:
        Number.isFinite(error?.precioPortal) ? error.precioPortal : undefined,
      precioObservado:
        Number.isFinite(error?.precioObservado)
          ? error.precioObservado
          : undefined,
      error:
        error instanceof Error
          ? error.message
          : "No fue posible procesar Cargos Muevo empresa.",
    });
  }
}
