import { requireAdmin, supabaseAdmin } from "../_lib/supabaseAdmin.js";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import {
  iniciarSesionCopec,
  obtenerTokenCopecActual,
} from "./login.js";

const COPEC_DOCUMENTO_URL =
  "https://portaldepago-api.copec.cl/pago/obtener-detalles-documento";
const CATEGORIAS_FACTURA = new Set([
  "COMBUSTIBLES",
  "PRODUCTOS_NO_COMBUSTIBLES",
  "COBROS_FIJOS",
  "MANTENCIONES",
  "POR_REVISAR",
]);

const TAMANO_PAGINA_RESUMEN = 1000;
const LIMITE_MAXIMO_TABLA = 200;
const MESES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

function convertirPeriodoConsulta(valor) {
  const periodo = String(valor || "").trim();
  const coincidencia = periodo.match(/^(\d{2});(\d{4})$/);

  if (!coincidencia) {
    return periodo;
  }

  const indiceMes = Number(coincidencia[1]) - 1;

  if (indiceMes < 0 || indiceMes >= MESES.length) {
    return periodo;
  }

  return `${MESES[indiceMes]} ${coincidencia[2]}`;
}

function obtenerLimite(valor) {
  const numero = Number.parseInt(valor, 10);

  if (!Number.isFinite(numero)) {
    return 100;
  }

  return Math.min(Math.max(numero, 1), LIMITE_MAXIMO_TABLA);
}

function esperar(milisegundos) {
  return new Promise((resolver) => setTimeout(resolver, milisegundos));
}

function normalizarTextoDocumento(valor) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\uFFFD/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function categorizarTextoDocumento(textoOriginal) {
  const texto = normalizarTextoDocumento(textoOriginal);

  if (
    /(VTA\.?\s*REPOSICION\.?\s*EDS|PETROLEO DIESEL|GASOLINA SP|GASOLINA 9[357]|KEROSENE|CLASE PEDIDO[^\n]{0,80}REPOSICION)/.test(
      texto
    )
  ) {
    return {
      categoria: "COMBUSTIBLES",
      confianza: 99,
      razones: ["Productos o clase de pedido de combustible"],
    };
  }

  if (
    /(VENTA SERVICIOS|SERVICIOS FACT|MANTENCION|MANTENIMIENTO|REPARACION|FALLA |SERVICIO TECNICO|REPUESTO|SURTIDOR|BREAKAWAY|MANGUERA|PISTOLA|PANTALLA DEFECTUOSA|TABLERO ELECTRICO|SOLICITUD EQUIPOS)/.test(
      texto
    )
  ) {
    return {
      categoria: "MANTENCIONES",
      confianza: 96,
      razones: ["Servicios, fallas, reparación o equipos de la estación"],
    };
  }

  if (
    /(COBRO FIJO|AGUA POTABLE|ELECTRICIDAD|ENERGIA ELECTRICA|CONSUMO LUZ|SERVICIO DE RED|PREVENCION|ARRIENDO|LICENCIA|TELECOMUNICACION|INTERNET|EQUIPO EN COMODATO)/.test(
      texto
    )
  ) {
    return {
      categoria: "COBROS_FIJOS",
      confianza: 90,
      razones: ["Servicio periódico o cobro fijo de operación"],
    };
  }

  if (
    /(LUBRICANTE|ACEITE|LAVAPARABRISAS|BLUE ?MAX|BIDON|COOLANT|PROMOCION|PRODUCTOS NO COMBUSTIBLES|VENTA PRODUCTOS)/.test(
      texto
    )
  ) {
    return {
      categoria: "PRODUCTOS_NO_COMBUSTIBLES",
      confianza: 92,
      razones: ["Mercadería o producto destinado a venta"],
    };
  }

  return {
    categoria: "POR_REVISAR",
    confianza: 0,
    razones: ["El documento no coincide todavía con una regla segura"],
  };
}

function extraerMetadatosDocumento(textoOriginal) {
  const texto = normalizarTextoDocumento(textoOriginal);
  const valor = (expresion) => texto.match(expresion)?.[1]?.trim() || null;

  return {
    numero_factura:
      valor(/FACTURA ELECTRONICA\s*N[O°º]?\s*(\d{5,})/) ||
      valor(/N[O°º]? SII\s+N[O°º]? INTERNO[\s\S]{0,120}?\b(\d{7,})\b/),
    numero_interno: valor(/N[O°º]? INTERNO[\s\S]{0,80}?\b(\d{7,})\b/),
    fecha_emision: valor(/FECHA EMISION[\s:]*([0-3]?\d-[A-Z]{3}-\d{4})/),
    numero_pedido: valor(/\bPEDIDO\b[\s\S]{0,180}?\b(\d{8,})\b/),
    clase_pedido: valor(/CLASE PEDIDO\s+([^\n\r]{3,80})/),
  };
}

async function consultarDocumentoCopec(token, factura) {
  const params = new URLSearchParams({
    factura_sd: factura.factura_sd,
    fecha_fact: factura.fecha_movimiento,
    id_eds: factura.codigo_eds,
  });
  let resultado = null;

  for (let intento = 0; intento < 3; intento += 1) {
    const respuesta = await fetch(`${COPEC_DOCUMENTO_URL}?${params}`, {
      method: "GET",
      headers: {
        token,
        Accept: "application/json",
        Origin: "https://portaldepago.copec.cl",
        Referer: "https://portaldepago.copec.cl/",
      },
    });
    const texto = await respuesta.text();
    let payload = null;

    try {
      payload = JSON.parse(texto);
    } catch {
      // La respuesta definitiva se valida después del último reintento.
    }

    resultado = { respuesta, payload };

    if (![502, 503, 504].includes(respuesta.status)) break;
    await esperar(700 * (intento + 1));
  }

  return resultado;
}

async function obtenerFacturas(periodo) {
  const { data, error } = await supabaseAdmin
    .from("copec_facturas_cargos")
    .select(
      "id, fecha_movimiento, fecha_vencimiento, codigo_eds, linea_producto, tipo_documento, numero_documento, factura_sd, clasificacion_origen, estado_origen, monto, periodo, categoria, categoria_origen, confianza_categoria, documento_disponible, documento_revisado, documento_actualizado_en, datos_origen, sincronizado_en"
    )
    .eq("periodo", periodo)
    .order("fecha_movimiento", { ascending: false })
    .order("monto", { ascending: false });

  if (error) {
    throw new Error(`No se pudieron obtener las facturas: ${error.message}`);
  }

  const facturas = (data || []).map((factura) => {
    const cuotas = Array.isArray(factura.datos_origen?.cuotas)
      ? factura.datos_origen.cuotas
      : [
          {
            fecha_movimiento: factura.fecha_movimiento,
            fecha_vencimiento: factura.fecha_vencimiento,
            monto: Number(factura.monto || 0),
          },
        ];
    const { datos_origen: _datosOrigen, ...facturaPublica } = factura;

    return {
      ...facturaPublica,
      cantidad_cuotas: cuotas.length,
      cuotas,
    };
  });
  const categorias = {};

  for (const factura of facturas) {
    const categoria = factura.categoria || "POR_REVISAR";
    categorias[categoria] ||= { cantidad: 0, monto: 0 };
    categorias[categoria].cantidad += 1;
    categorias[categoria].monto += Number(factura.monto || 0);
  }

  return {
    facturas,
    resumen: {
      periodo,
      cantidad: facturas.length,
      montoTotal: facturas.reduce(
        (total, factura) => total + Number(factura.monto || 0),
        0
      ),
      pendientes: facturas.filter(
        (factura) => factura.categoria === "POR_REVISAR"
      ).length,
      categorias,
      ultimaSincronizacion:
        facturas.map((factura) => factura.sincronizado_en).sort().at(-1) || null,
    },
  };
}

async function clasificarFactura(id, categoria) {
  if (!id || !CATEGORIAS_FACTURA.has(categoria)) {
    throw new Error("Factura o categoría no válida.");
  }

  const { data, error } = await supabaseAdmin
    .from("copec_facturas_cargos")
    .update({
      categoria,
      categoria_origen: "manual",
      confianza_categoria: 100,
      actualizado_en: new Date().toISOString(),
    })
    .eq("id", id)
    .select("id, categoria, categoria_origen")
    .single();

  if (error) {
    throw new Error(`No se pudo guardar la categoría: ${error.message}`);
  }

  return data;
}

async function obtenerEnlaceDocumento(id) {
  const { data: factura, error } = await supabaseAdmin
    .from("copec_facturas_cargos")
    .select("id, factura_sd, fecha_movimiento, codigo_eds")
    .eq("id", id)
    .single();

  if (error || !factura) {
    throw new Error("No se encontró la factura solicitada.");
  }

  if (!factura.factura_sd) {
    throw new Error("La factura no contiene el identificador del documento.");
  }

  let token = obtenerTokenCopecActual();
  if (!token) token = (await iniciarSesionCopec()).accessToken;

  let consulta = await consultarDocumentoCopec(token, factura);

  if ([401, 403].includes(consulta.respuesta.status)) {
    token = (await iniciarSesionCopec()).accessToken;
    consulta = await consultarDocumentoCopec(token, factura);
  }

  if (!consulta.respuesta.ok) {
    throw new Error(
      `Copec rechazó el documento con estado ${consulta.respuesta.status}.`
    );
  }

  const enlace = consulta.payload?.data?.url;
  let url;

  try {
    url = new URL(enlace);
  } catch {
    throw new Error("Copec no entregó un enlace válido para la factura.");
  }

  if (
    !["http:", "https:"].includes(url.protocol) ||
    !url.hostname.toLowerCase().endsWith("acepta.com")
  ) {
    throw new Error("El documento fue entregado desde un dominio no permitido.");
  }

  await supabaseAdmin
    .from("copec_facturas_cargos")
    .update({
      documento_disponible: true,
      documento_actualizado_en: new Date().toISOString(),
      actualizado_en: new Date().toISOString(),
    })
    .eq("id", factura.id);

  return url.toString();
}

function construirEnlacePdfAcepta(enlaceDocumento) {
  const url = new URL(enlaceDocumento);

  if (!url.hostname.toLowerCase().endsWith("acepta.com")) {
    throw new Error("El documento no pertenece a un dominio permitido.");
  }

  return `https://${url.hostname}/ca4webv3/PdfViewMedia?url=${encodeURIComponent(
    url.toString()
  )}`;
}

async function descargarPdfAcepta(enlaceDocumento) {
  const enlacePdf = construirEnlacePdfAcepta(enlaceDocumento);
  let ultimaRespuesta = null;

  for (let intento = 0; intento < 3; intento += 1) {
    const respuesta = await fetch(enlacePdf, {
      method: "GET",
      headers: { Accept: "application/pdf" },
      redirect: "follow",
    });
    const buffer = Buffer.from(await respuesta.arrayBuffer());
    ultimaRespuesta = { respuesta, buffer };

    if (
      respuesta.ok &&
      buffer.length > 5 &&
      buffer.subarray(0, 5).toString("ascii") === "%PDF-"
    ) {
      return buffer;
    }

    if (![502, 503, 504].includes(respuesta.status)) break;
    await esperar(600 * (intento + 1));
  }

  throw new Error(
    `Acepta no entregó un PDF válido${
      ultimaRespuesta?.respuesta?.status
        ? ` (estado ${ultimaRespuesta.respuesta.status})`
        : ""
    }.`
  );
}

async function analizarFacturaDocumento(factura) {
  const enlaceDocumento = await obtenerEnlaceDocumento(factura.id);
  const pdf = await descargarPdfAcepta(enlaceDocumento);
  const contenido = await pdfParse(pdf);
  const texto = String(contenido?.text || "").trim();

  if (texto.length < 80) {
    throw new Error("La factura no contiene texto suficiente para analizarla.");
  }

  const clasificacion = categorizarTextoDocumento(texto);
  const metadatos = extraerMetadatosDocumento(texto);
  const ahora = new Date().toISOString();
  const datosOrigen = {
    ...(factura.datos_origen || {}),
    documento: {
      fuente: "PDF_ACEPTA",
      analizado_en: ahora,
      paginas: Number(contenido?.numpages || 0),
      categoria_sugerida: clasificacion.categoria,
      confianza: clasificacion.confianza,
      razones: clasificacion.razones,
      metadatos,
    },
  };
  const cambios = {
    documento_disponible: true,
    documento_revisado: true,
    documento_texto: texto,
    documento_actualizado_en: ahora,
    datos_origen: datosOrigen,
    actualizado_en: ahora,
  };

  if (
    factura.categoria_origen !== "manual" &&
    clasificacion.categoria !== "POR_REVISAR"
  ) {
    cambios.categoria = clasificacion.categoria;
    cambios.categoria_origen = "documento";
    cambios.confianza_categoria = clasificacion.confianza;
  }

  const { data, error } = await supabaseAdmin
    .from("copec_facturas_cargos")
    .update(cambios)
    .eq("id", factura.id)
    .select("id, numero_documento, categoria, categoria_origen, confianza_categoria")
    .single();

  if (error) {
    throw new Error(`No se pudo guardar el análisis: ${error.message}`);
  }

  return {
    ...data,
    sugerencia: clasificacion.categoria,
    confianza: clasificacion.confianza,
    metadatos,
  };
}

async function analizarFacturasPendientes(periodo, limiteSolicitado = 3) {
  const limite = Math.min(Math.max(Number(limiteSolicitado) || 3, 1), 3);
  const { data: facturas, error } = await supabaseAdmin
    .from("copec_facturas_cargos")
    .select(
      "id, numero_documento, factura_sd, categoria, categoria_origen, datos_origen"
    )
    .eq("periodo", periodo)
    .eq("categoria", "POR_REVISAR")
    .eq("documento_revisado", false)
    .neq("categoria_origen", "manual")
    .not("factura_sd", "is", null)
    .limit(limite);

  if (error) {
    throw new Error(`No se pudieron obtener las facturas pendientes: ${error.message}`);
  }

  const resultados = [];
  const errores = [];

  for (const factura of facturas || []) {
    try {
      resultados.push(await analizarFacturaDocumento(factura));
    } catch (errorFactura) {
      errores.push({
        id: factura.id,
        numeroDocumento: factura.numero_documento,
        error:
          errorFactura instanceof Error
            ? errorFactura.message
            : "No fue posible analizar la factura.",
      });
    }
  }

  const { count, error: errorConteo } = await supabaseAdmin
    .from("copec_facturas_cargos")
    .select("id", { count: "exact", head: true })
    .eq("periodo", periodo)
    .eq("categoria", "POR_REVISAR")
    .eq("documento_revisado", false)
    .neq("categoria_origen", "manual")
    .not("factura_sd", "is", null);

  if (errorConteo) {
    throw new Error(`No se pudieron contar las facturas pendientes: ${errorConteo.message}`);
  }

  return {
    analizadas: resultados.length,
    clasificadas: resultados.filter(
      (resultado) => resultado.sugerencia !== "POR_REVISAR"
    ).length,
    sinClasificar: resultados.filter(
      (resultado) => resultado.sugerencia === "POR_REVISAR"
    ).length,
    pendientesRestantes: count || 0,
    resultados,
    errores,
  };
}

async function obtenerUltimaSincronizacion(periodo = "") {
  let consulta = supabaseAdmin
    .from("sincronizaciones")
    .select(
      "id, periodo, estado, registros_encontrados, registros_guardados, mensaje, iniciado_en, finalizado_en"
    )
    .eq("integracion", "copec")
    .eq("estado", "completado");

  if (periodo) {
    consulta = consulta.eq("periodo", periodo);
  }

  const { data, error } = await consulta
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

  if (!(await requireAdmin(request, response))) return;

  if (!["GET", "POST"].includes(request.method)) {
    return response.status(405).json({
      ok: false,
      error: "Método no permitido.",
    });
  }

  try {
    const recurso = String(request.query.recurso || "").trim();

    if (request.method === "POST") {
      const accion = String(request.body?.accion || "").trim();

      if (accion === "clasificar_factura") {
        const factura = await clasificarFactura(
          String(request.body?.id || "").trim(),
          String(request.body?.categoria || "").trim()
        );

        return response.status(200).json({
          ok: true,
          mensaje: "Categoría actualizada correctamente.",
          factura,
        });
      }

      if (accion === "analizar_facturas") {
        const periodo = convertirPeriodoConsulta(
          String(request.body?.periodo || "").trim()
        );

        if (!periodo) {
          return response.status(400).json({
            ok: false,
            error: "Debes informar el período que se analizará.",
          });
        }

        const resultado = await analizarFacturasPendientes(
          periodo,
          request.body?.limite
        );

        return response.status(200).json({
          ok: true,
          mensaje: resultado.analizadas
            ? `${resultado.analizadas} factura(s) analizadas desde su PDF.`
            : "No quedan facturas nuevas disponibles para analizar.",
          ...resultado,
        });
      }

      return response.status(400).json({
        ok: false,
        error: "Acción no válida.",
      });
    }

    const periodoSolicitado =
      typeof request.query.periodo === "string"
        ? request.query.periodo.trim()
        : "";
    const periodoBase = convertirPeriodoConsulta(periodoSolicitado);

    if (recurso === "facturas") {
      if (!periodoBase) {
        return response.status(400).json({
          ok: false,
          error: "Debes informar el período de las facturas.",
        });
      }

      const resultado = await obtenerFacturas(periodoBase);
      return response.status(200).json({
        ok: true,
        conectado: true,
        ...resultado,
        fechaConsulta: new Date().toISOString(),
      });
    }

    if (recurso === "documento_factura") {
      const enlace = await obtenerEnlaceDocumento(
        String(request.query.id || "").trim()
      );

      return response.status(200).json({
        ok: true,
        enlace,
      });
    }

    const ultimaSincronizacion = await obtenerUltimaSincronizacion(
      periodoBase
    );
    const periodo =
      periodoBase ||
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
