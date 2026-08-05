import { supabaseAdmin } from "../_lib/supabaseAdmin.js";
import {
  iniciarSesionCopec,
  obtenerTokenCopecActual,
} from "./login.js";

const COPEC_API_URL =
  "https://portaldepago-api.copec.cl/pago/movimientos-cartola";
const COPEC_PRECIOS_URL =
  "https://cuentacorriente-api.copec.cl/cuenta-corriente/obtener-precios";
const COPEC_FLUCTUACIONES_URL =
  "https://fluctuaciones-api.copec.cl/fluctuaciones/cierre-diario-historial-fluctuaciones";
const CAMIONES_FLUCTUACION_RECOMPRA = new Set(["VCTG38", "VCTG39"]);

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

function convertirFechaPrecio(valor) {
  const texto = String(valor || "").trim();
  const coincidencia = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);

  return coincidencia
    ? `${coincidencia[3]}-${coincidencia[2]}-${coincidencia[1]}`
    : convertirFecha(valor);
}

function convertirFechaCompacta(valor) {
  const texto = String(valor || "").trim();
  const coincidencia = texto.match(/^(\d{4})(\d{2})(\d{2})$/);

  return coincidencia
    ? `${coincidencia[1]}-${coincidencia[2]}-${coincidencia[3]}`
    : convertirFecha(valor);
}

function normalizarTexto(valor) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^0-9A-Z]+/gi, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function completarCodigo(valor, largo) {
  return String(valor || "").replace(/\D/g, "").padStart(largo, "0");
}

function fechaChileActual() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function desplazarFecha(fecha, dias) {
  const valor = new Date(`${fecha}T12:00:00Z`);
  valor.setUTCDate(valor.getUTCDate() + dias);
  return valor.toISOString().slice(0, 10);
}

function rangoPeriodoPrecios(periodo) {
  const coincidencia = String(periodo || "").match(/^(\d{2});(\d{4})$/);

  if (!coincidencia) {
    const hoy = fechaChileActual();
    return { desde: `${hoy.slice(0, 7)}-01`, hasta: hoy };
  }

  const mes = Number(coincidencia[1]);
  const anio = Number(coincidencia[2]);
  const ultimoDia = new Date(Date.UTC(anio, mes, 0))
    .toISOString()
    .slice(0, 10);
  const hoy = fechaChileActual();

  return {
    desde: `${anio}-${String(mes).padStart(2, "0")}-01`,
    hasta: ultimoDia > hoy ? hoy : ultimoDia,
  };
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

function descripcionCargoMuevo(movimiento) {
  const candidatos = [
    movimiento.TIPO_DOCUMENTO,
    movimiento.DESCRIPCION,
    movimiento.CLASIFICACION,
    movimiento.LINEA_PRODUCTO,
    movimiento.GLOSA,
    ...Object.values(movimiento || {}),
  ];

  return candidatos.find(
    (valor) =>
      ["string", "number"].includes(typeof valor) &&
      normalizarTexto(valor).includes("CONSUMO MUEVO EMPRESA")
  );
}

function crearIdentificadorCargoMuevo(movimiento) {
  return [
    "muevo-cargo-v1",
    convertirFecha(movimiento.FECHA_MOVIMIENTO) || "",
    textoClave(
      movimiento.NUMERO_DOCUMENTO || movimiento.FACTURA_SD
    ),
    textoClave(
      movimiento.NUMERO_EDS || movimiento.NUMERO_OFICINA
    ),
    textoClave(descripcionCargoMuevo(movimiento)),
    montoClave(movimiento.CARGO),
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

async function consultarPreciosCopec(token, params) {
  const respuesta = await fetch(
    `${COPEC_PRECIOS_URL}?${params.toString()}`,
    {
      method: "GET",
      headers: {
        token,
        Accept: "application/json",
        Origin: "https://prefactura.copec.cl",
        Referer: "https://prefactura.copec.cl/",
      },
    }
  );
  const texto = await respuesta.text();
  let payload = null;

  try {
    payload = JSON.parse(texto);
  } catch {
    // El detalle se valida sobre la respuesta definitiva.
  }

  return { respuesta, payload };
}

async function consultarFluctuacionesCopec(token, params) {
  const respuesta = await fetch(
    `${COPEC_FLUCTUACIONES_URL}?${params.toString()}`,
    {
      method: "GET",
      headers: {
        token,
        Accept: "application/json",
        Origin: "https://cuentacorriente.copec.cl",
        Referer: "https://cuentacorriente.copec.cl/",
      },
    }
  );
  const texto = await respuesta.text();
  let payload = null;

  try {
    payload = JSON.parse(texto);
  } catch {
    // La respuesta definitiva se valida despues de renovar o reintentar.
  }

  return { respuesta, payload };
}

async function sincronizarFluctuacionesRecompra(
  tokenInicial,
  periodo,
  codigoEds,
  idPagador
) {
  const coincidenciaPeriodo = String(periodo || "").match(/^(\d{2});(\d{4})$/);

  if (!coincidenciaPeriodo) {
    return {
      encontrados: 0,
      guardados: 0,
      mensaje: "Periodo no informado; fluctuaciones omitidas.",
    };
  }

  const params = new URLSearchParams({
    ID_EDS: completarCodigo(codigoEds, 10),
    PERIODO: periodo,
    ID_PAGADOR: completarCodigo(idPagador, 10),
  });
  let token = tokenInicial;
  let consulta = await consultarFluctuacionesCopec(token, params);

  if ([401, 403].includes(consulta.respuesta.status)) {
    const sesion = await iniciarSesionCopec();
    token = sesion.accessToken;
    consulta = await consultarFluctuacionesCopec(token, params);
  }

  if ([502, 503, 504].includes(consulta.respuesta.status)) {
    await new Promise((resolver) => setTimeout(resolver, 700));
    consulta = await consultarFluctuacionesCopec(token, params);
  }

  if (!consulta.respuesta.ok || !consulta.payload) {
    throw new Error(
      `Copec rechazo la consulta de fluctuaciones con estado ${consulta.respuesta.status}.`
    );
  }

  const tanques = Array.isArray(consulta.payload?.data?.tanques)
    ? consulta.payload.data.tanques
    : [];
  const registros = [];

  for (const tanque of tanques) {
    const nombreTanque = String(tanque?.tanque || "").trim();
    const codigoCamion = [...CAMIONES_FLUCTUACION_RECOMPRA].find((codigo) =>
      normalizarTexto(nombreTanque).includes(codigo)
    );

    if (!codigoCamion) continue;

    for (const cierre of Array.isArray(tanque?.cierres) ? tanque.cierres : []) {
      const fecha = convertirFechaCompacta(cierre?.fecha);

      if (!fecha) continue;

      registros.push({
        identificador_origen: [
          "fluctuacion-mesa-v1",
          codigoEds,
          codigoCamion,
          fecha,
        ].join("|"),
        fecha,
        codigo_eds: String(codigoEds),
        tipo: "fluctuacion_mesa",
        producto: "DIESEL",
        // Se conserva el signo informado por Copec. "Sumar fluctuacion"
        // significa agregar este valor, incluso cuando es negativo.
        litros: convertirNumero(cierre?.fluctuacion_diaria_lts),
        referencia: codigoCamion,
        descripcion: `Fluctuacion mesa de carga ${codigoCamion}`,
        fuente: "portal_concesionario_fluctuaciones",
        datos_origen: {
          tanque: nombreTanque,
          material: tanque?.material || cierre?.material || null,
          cierre,
        },
        sincronizado_en: new Date().toISOString(),
      });
    }
  }

  if (registros.length > 0) {
    const { error } = await supabaseAdmin
      .from("recompra_ajustes")
      .upsert(registros, { onConflict: "identificador_origen" });

    if (error) {
      throw new Error(
        `No se pudieron guardar las fluctuaciones: ${error.message}`
      );
    }
  }

  return {
    encontrados: registros.length,
    guardados: registros.length,
    camiones: [...CAMIONES_FLUCTUACION_RECOMPRA],
    litrosNetos: registros.reduce(
      (total, registro) => total + convertirNumero(registro.litros),
      0
    ),
  };
}

async function sincronizarPreciosCosto(tokenInicial, periodo, codigoEds) {
  const rango = rangoPeriodoPrecios(periodo);
  const { data: historial, error: errorHistorial } = await supabaseAdmin
    .from("copec_precios_costo")
    .select("fecha_vigencia")
    .eq("codigo_eds", codigoEds)
    .order("fecha_vigencia", { ascending: true });

  if (errorHistorial) {
    throw new Error(
      `No se pudo revisar el historial de precios: ${errorHistorial.message}`
    );
  }

  const fechasGuardadas = (historial || [])
    .map((registro) => registro.fecha_vigencia)
    .filter(Boolean);
  const primeraFecha = fechasGuardadas[0] || null;
  const ultimaFecha = fechasGuardadas.at(-1) || null;
  let fechaDesde;

  if (!ultimaFecha || (primeraFecha && rango.desde < primeraFecha)) {
    // Se necesita al menos un precio anterior al primer día consultado para
    // determinar correctamente cuál estaba vigente. Un año mantiene el
    // volumen pequeño y cubre períodos largos sin cambios.
    fechaDesde = desplazarFecha(rango.desde, -365);
  } else if (ultimaFecha > rango.hasta) {
    return {
      encontrados: 0,
      guardados: 0,
      registrados: fechasGuardadas.length,
      desde: ultimaFecha,
      hasta: rango.hasta,
      ultimaVigencia: ultimaFecha,
    };
  } else {
    fechaDesde = ultimaFecha;
  }

  const params = new URLSearchParams({
    eds: codigoEds,
    fecha_desde: fechaDesde,
    fecha_hasta: rango.hasta,
  });
  let token = tokenInicial;
  let consulta = await consultarPreciosCopec(token, params);

  if ([401, 403].includes(consulta.respuesta.status)) {
    const sesion = await iniciarSesionCopec();
    token = sesion.accessToken;
    consulta = await consultarPreciosCopec(token, params);
  }

  if ([502, 503, 504].includes(consulta.respuesta.status)) {
    await new Promise((resolver) => setTimeout(resolver, 700));
    consulta = await consultarPreciosCopec(token, params);
  }

  if (!consulta.respuesta.ok || !consulta.payload) {
    throw new Error(
      `Copec rechazó la consulta de precios con estado ${consulta.respuesta.status}.`
    );
  }

  const precios = Array.isArray(consulta.payload?.data?.PRECIOS)
    ? consulta.payload.data.PRECIOS
    : [];
  const localidad = String(consulta.payload?.data?.localidad || "").trim();
  const registros = precios
    .map((precio) => ({
      codigo_eds: codigoEds,
      fecha_vigencia: convertirFechaPrecio(precio.fecha),
      localidad: localidad || null,
      gas_93sp: convertirNumero(precio.G93SP),
      gas_95sp: convertirNumero(precio.G95SP),
      gas_97sp: convertirNumero(precio.G97SP),
      kerosene: convertirNumero(precio.KERO),
      diesel_pdua1: convertirNumero(precio.PDUA1),
      datos_origen: precio,
      sincronizado_en: new Date().toISOString(),
    }))
    .filter((registro) => registro.fecha_vigencia);
  const fechasExistentes = new Set(fechasGuardadas);
  const registrosNuevos = registros.filter(
    (registro) => !fechasExistentes.has(registro.fecha_vigencia)
  );

  if (registrosNuevos.length > 0) {
    const { error } = await supabaseAdmin
      .from("copec_precios_costo")
      .upsert(registrosNuevos, {
        onConflict: "codigo_eds,fecha_vigencia",
      });

    if (error) {
      throw new Error(`No se pudieron guardar los precios costo: ${error.message}`);
    }
  }

  return {
    encontrados: precios.length,
    guardados: registrosNuevos.length,
    registrados: fechasGuardadas.length + registrosNuevos.length,
    desde: fechaDesde,
    hasta: rango.hasta,
    ultimaVigencia:
      registros.map((registro) => registro.fecha_vigencia).sort().at(-1) ||
      ultimaFecha,
  };
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
  const codigoEdsPrecios =
    process.env.COPEC_EDS_PRECIOS || (idEds !== "*" ? idEds : "40098");
  const idPagador = process.env.COPEC_ID_PAGADOR || "0000718534";

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
    const cargosMuevo = movimientos.filter(
      (movimiento) =>
        convertirNumero(movimiento.CARGO) > 0 &&
        descripcionCargoMuevo(movimiento)
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
    const cargosPorIdentificador = new Map();

    for (const movimiento of cargosMuevo) {
      const identificadorOrigen = crearIdentificadorCargoMuevo(movimiento);

      cargosPorIdentificador.set(identificadorOrigen, {
        identificador_origen: identificadorOrigen,
        fecha: convertirFecha(movimiento.FECHA_MOVIMIENTO),
        codigo_eds: String(
          movimiento.NUMERO_EDS ||
            movimiento.NUMERO_OFICINA ||
            idEds
        ),
        descripcion: String(
          descripcionCargoMuevo(movimiento) || "Consumo Muevo Empresa"
        ),
        referencia:
          movimiento.NUMERO_DOCUMENTO ||
          movimiento.FACTURA_SD ||
          null,
        monto: convertirNumero(movimiento.CARGO),
        periodo: periodoRespuesta,
        datos_origen: movimiento,
        sincronizado_en: new Date().toISOString(),
      });
    }

    const registrosCargosMuevo = [...cargosPorIdentificador.values()];

    let registrosGuardados = 0;
    let cargosMuevoGuardados = 0;

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

    if (registrosCargosMuevo.length > 0) {
      const { data: guardados, error: errorCargos } =
        await supabaseAdmin
          .from("muevo_empresa_cargos")
          .upsert(registrosCargosMuevo, {
            onConflict: "identificador_origen",
          })
          .select("id");

      if (errorCargos) {
        throw new Error(
          `No se pudieron guardar los cargos Muevo Empresa: ${errorCargos.message}`
        );
      }

      cargosMuevoGuardados = guardados?.length || 0;
    }

    const totalAbonos = registros.reduce(
      (total, registro) => total + registro.monto,
      0
    );
    let preciosCosto = null;
    let preciosCostoError = null;
    let fluctuacionesRecompra = null;
    let fluctuacionesRecompraError = null;

    try {
      preciosCosto = await sincronizarPreciosCosto(
        token,
        periodo,
        codigoEdsPrecios
      );
    } catch (errorPrecios) {
      preciosCostoError =
        errorPrecios instanceof Error
          ? errorPrecios.message
          : "No fue posible sincronizar los precios costo.";
      console.error("Error sincronizando precios costo:", errorPrecios);
    }

    try {
      fluctuacionesRecompra = await sincronizarFluctuacionesRecompra(
        token,
        periodo,
        codigoEdsPrecios,
        idPagador
      );
    } catch (errorFluctuaciones) {
      fluctuacionesRecompraError =
        errorFluctuaciones instanceof Error
          ? errorFluctuaciones.message
          : "No fue posible sincronizar las fluctuaciones.";
      console.error(
        "Error sincronizando fluctuaciones Recompra:",
        errorFluctuaciones
      );
    }

    await supabaseAdmin
      .from("sincronizaciones")
      .update({
        estado: "completado",
        periodo: periodoRespuesta,
        // Conserva las metricas historicas de la sincronizacion de abonos.
        // Los cargos Muevo se informan separadamente en la respuesta.
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
      cargosMuevoEncontrados: cargosMuevo.length,
      cargosMuevoGuardados,
      totalCargosMuevo: registrosCargosMuevo.reduce(
        (total, registro) => total + registro.monto,
        0
      ),
      preciosCosto,
      preciosCostoError,
      fluctuacionesRecompra,
      fluctuacionesRecompraError,
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
