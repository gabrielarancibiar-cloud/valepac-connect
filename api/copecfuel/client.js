import { supabaseAdmin } from "../_lib/supabaseAdmin.js";

const COPECFUEL_API_URL =
  process.env.COPECFUEL_API_URL || "https://api2pr.copecfuel.com";

const TIMEOUT_MS = 30_000;

let sesionEnMemoria = null;

async function guardarSesion(sesion, estado) {
  const { error } = await supabaseAdmin.from("integracion_sesiones").upsert(
    {
      integracion: "copecfuel",
      token: sesion.token,
      cuenta_id: sesion.cuentaId || null,
      cliente_id: sesion.clienteId || null,
      ubicaciones: sesion.ubicaciones || [],
      estado,
      actualizado_en: new Date().toISOString(),
    },
    { onConflict: "integracion" }
  );

  if (error) {
    throw new Error(`No se pudo guardar la sesion CopecFuel: ${error.message}`);
  }
}

async function cargarSesionGuardada() {
  const { data, error } = await supabaseAdmin
    .from("integracion_sesiones")
    .select(
      "token, cuenta_id, cliente_id, ubicaciones, estado, actualizado_en"
    )
    .eq("integracion", "copecfuel")
    .maybeSingle();

  if (error) {
    throw new Error(`No se pudo leer la sesion CopecFuel: ${error.message}`);
  }

  if (!data?.token) {
    return null;
  }

  return {
    token: data.token,
    cuentaId: data.cuenta_id || "",
    clienteId: data.cliente_id || "",
    ubicaciones: Array.isArray(data.ubicaciones) ? data.ubicaciones : [],
    usuarioActivo: true,
    maquinaActiva: data.estado === "conectado",
    requiereCodigoEquipo: data.estado === "pendiente_codigo",
    requiereCambioPassword: false,
    estado: data.estado,
  };
}

function textoSeguro(valor) {
  return typeof valor === "string" ? valor.trim() : "";
}

function leerBandera(data, nombreSnake, nombreCamel) {
  const valor = data?.[nombreSnake] ?? data?.[nombreCamel];
  return valor === true || valor === 1 || valor === "1";
}

function buscarMensaje(valor, profundidad = 0) {
  if (profundidad > 4 || valor === null || valor === undefined) {
    return "";
  }

  if (typeof valor === "string" || typeof valor === "number") {
    return String(valor).trim();
  }

  if (Array.isArray(valor)) {
    return valor
      .map((item) => buscarMensaje(item, profundidad + 1))
      .filter(Boolean)
      .join(" ");
  }

  if (typeof valor === "object") {
    const camposPreferidos = [
      "mensaje",
      "message",
      "descripcion",
      "description",
      "detalle",
      "detail",
      "error",
      "title",
      "titulo",
    ];

    for (const campo of camposPreferidos) {
      const mensaje = buscarMensaje(valor[campo], profundidad + 1);

      if (mensaje) {
        return mensaje;
      }
    }

    return Object.values(valor)
      .map((item) => buscarMensaje(item, profundidad + 1))
      .filter(Boolean)
      .join(" ");
  }

  return "";
}

function extraerMensaje(payload, estado) {
  const candidatos = [
    payload?.userMessage,
    payload?.message,
    payload?.error,
    payload?.data?.message,
    payload?.data,
  ];

  for (const candidato of candidatos) {
    const mensaje = buscarMensaje(candidato);

    if (mensaje) {
      return mensaje;
    }
  }

  return `CopecFuel respondio con estado ${estado}.`;
}

async function solicitar(ruta, opciones = {}) {
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), TIMEOUT_MS);
  const headers = new Headers(opciones.headers || {});

  headers.set("Accept", "application/json");

  if (opciones.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  if (opciones.token) {
    headers.set("token", opciones.token);
  }

  try {
    const respuesta = await fetch(
      `${COPECFUEL_API_URL}/${String(ruta).replace(/^\/+/, "")}`,
      {
        method: opciones.method || "GET",
        headers,
        body:
          opciones.body === undefined
            ? undefined
            : JSON.stringify(opciones.body),
        signal: controlador.signal,
      }
    );

    const texto = await respuesta.text();
    let payload = null;

    if (texto) {
      try {
        payload = JSON.parse(texto);
      } catch {
        payload = { raw: texto.slice(0, 500) };
      }
    }

    if (!respuesta.ok) {
      const error = new Error(extraerMensaje(payload, respuesta.status));
      error.status = respuesta.status;
      error.payload = payload;
      throw error;
    }

    return payload || {};
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("CopecFuel no respondio dentro de 30 segundos.");
    }

    throw error;
  } finally {
    clearTimeout(temporizador);
  }
}

function extraerUbicaciones(perfiles) {
  if (!perfiles || typeof perfiles !== "object") {
    return [];
  }

  const ubicaciones = [];

  for (const [perfil, detalle] of Object.entries(perfiles)) {
    const estaciones = Array.isArray(detalle?.estaciones)
      ? detalle.estaciones
      : [];

    for (const estacion of estaciones) {
      const ubicacionId = estacion?.ubicacionId;

      if (!ubicacionId) {
        continue;
      }

      ubicaciones.push({
        perfil,
        ubicacionId: String(ubicacionId),
        codigo: estacion?.ubicacionCodigo || null,
        direccion: estacion?.ubicacionDireccion || null,
        activa: String(estacion?.estado || "").toUpperCase() === "ACTIVO",
        clienteId: estacion?.clienteId
          ? String(estacion.clienteId)
          : null,
      });
    }
  }

  return ubicaciones.filter(
    (ubicacion, indice, lista) =>
      lista.findIndex(
        (otra) => otra.ubicacionId === ubicacion.ubicacionId
      ) === indice
  );
}

export async function generarTokenInicialCopecFuel() {
  const payload = await solicitar("SEGCTA1/generartoken", {
    method: "POST",
    body: {},
  });

  const token = textoSeguro(payload?.data?.token);

  if (!token) {
    throw new Error("CopecFuel no entrego el token inicial.");
  }

  return token;
}

export async function iniciarSesionCopecFuel() {
  const clienteId = textoSeguro(process.env.COPECFUEL_CLIENTE_ID);
  const cuentaId = textoSeguro(process.env.COPECFUEL_CUENTA_ID);
  const email = textoSeguro(process.env.COPECFUEL_EMAIL).toLowerCase();
  const password = process.env.COPECFUEL_PASSWORD || "";
  const tipoLogin =
    textoSeguro(process.env.COPECFUEL_TIPO_LOGIN) || "Concesionario";

  if (!email || !password) {
    throw new Error(
      "Faltan COPECFUEL_EMAIL y COPECFUEL_PASSWORD en Vercel."
    );
  }

  if (tipoLogin === "Concesionario" && !clienteId) {
    throw new Error(
      "Falta COPECFUEL_CLIENTE_ID en Vercel para el acceso de concesionario."
    );
  }

  if (tipoLogin === "Admin" && !cuentaId) {
    throw new Error(
      "Falta COPECFUEL_CUENTA_ID en Vercel para el acceso administrativo."
    );
  }

  const tokenInicial = await generarTokenInicialCopecFuel();
  const payload = await solicitar("SEGCTA1/iniciosesion", {
    method: "POST",
    token: tokenInicial,
    body: {
      cuentaId: tipoLogin === "Admin" ? cuentaId : "",
      clienteId: tipoLogin === "Concesionario" ? clienteId : "",
      email,
      password,
    },
  });

  const data = payload?.data || {};
  const token = textoSeguro(data.token);
  const usuarioActivo = leerBandera(data, "usr_activo", "usrActivo");
  const maquinaActiva = leerBandera(data, "maq_activo", "maqActivo");
  const requiereCambioPassword = Boolean(data.cambia_password);
  const ubicaciones = extraerUbicaciones(data.perfiles);

  if (!token) {
    throw new Error("CopecFuel no entrego un token despues del login.");
  }

  const sesion = {
    token,
    cuentaId: textoSeguro(data.cuentaId) || cuentaId,
    clienteId,
    usuarioId: textoSeguro(data.usuarioId),
    usuarioActivo,
    maquinaActiva,
    requiereCambioPassword,
    requiereCodigoEquipo: usuarioActivo && !maquinaActiva,
    ubicaciones,
  };

  sesionEnMemoria = sesion;
  await guardarSesion(
    sesion,
    sesion.requiereCodigoEquipo ? "pendiente_codigo" : "conectado"
  );
  return sesion;
}

export async function obtenerSesionCopecFuel() {
  const sesionGuardada = await cargarSesionGuardada();

  // Supabase es la fuente de verdad entre funciones serverless. Una instancia
  // de Vercel puede conservar en memoria un token anterior al ultimo correo.
  if (sesionGuardada?.token) {
    sesionEnMemoria = sesionGuardada;
    return sesionGuardada;
  }

  if (sesionEnMemoria?.token) {
    return sesionEnMemoria;
  }

  return iniciarSesionCopecFuel();
}

export async function validarCodigoEquipoCopecFuel(codigo) {
  const codigoLimpio = textoSeguro(codigo).replace(/[\s_]+/g, "");

  if (!codigoLimpio) {
    throw new Error("Debes ingresar el codigo enviado por CopecFuel.");
  }

  if (!/^[0-9a-zA-Z]{6}$/.test(codigoLimpio)) {
    throw new Error(
      "El codigo debe contener seis letras o numeros, por ejemplo: e6 3a 7b."
    );
  }

  // La validacion debe usar siempre el token asociado al ultimo codigo
  // enviado. No se prioriza la memoria local porque otra instancia de Vercel
  // pudo haber solicitado un codigo mas reciente y guardado su sesion.
  const sesionGuardada = await cargarSesionGuardada();
  const sesion = sesionGuardada?.token
    ? sesionGuardada
    : sesionEnMemoria;

  if (!sesion?.token) {
    throw new Error(
      "No existe una sesion pendiente. Ejecuta primero probar-conexion."
    );
  }

  sesionEnMemoria = sesion;

  const payload = await solicitar("SEGCTA1/validacodigoequipo", {
    method: "POST",
    token: sesion.token,
    body: {
      codigoMail: codigoLimpio,
      cuentaId: sesion.cuentaId,
      clienteId: sesion.clienteId,
    },
  });

  const tokenValidado = textoSeguro(payload?.data?.token);

  if (!tokenValidado) {
    throw new Error("CopecFuel no entrego un token validado.");
  }

  const sesionValidada = {
    ...sesion,
    token: tokenValidado,
    usuarioActivo: true,
    maquinaActiva: true,
    requiereCodigoEquipo: false,
    requiereCambioPassword: false,
    estado: "conectado",
  };

  sesionEnMemoria = sesionValidada;
  await guardarSesion(sesionValidada, "conectado");
  return sesionValidada;
}

export async function consultarTransaccionesOficialesCopecFuel(turnoId) {
  const token = textoSeguro(process.env.COPEC_FUEL_VENTAS_TOKEN);
  const clienteId = textoSeguro(process.env.COPEC_FUEL_CLIENTE_ID);
  const turno = String(turnoId || "").replace(/\D/g, "");

  if (!token) {
    throw new Error("Falta COPEC_FUEL_VENTAS_TOKEN en Vercel.");
  }

  if (!/^\d{12}$/.test(clienteId)) {
    throw new Error(
      "COPEC_FUEL_CLIENTE_ID debe contener exactamente 12 digitos."
    );
  }

  if (!/^\d{8}$/.test(turno)) {
    const error = new Error("turnoId debe usar el formato AAAAMMDD.");
    error.status = 400;
    throw error;
  }

  return solicitar("INTEGR1/transacciones", {
    method: "POST",
    token,
    body: {
      clienteId,
      turnoId: turno,
      tipoReporte: ["VENTA_COMBUSTIBLE"],
    },
  });
}

export async function consultarCopecFuel(ruta, sesionInicial = null) {
  let sesion = sesionInicial || (await obtenerSesionCopecFuel());

  try {
    return await solicitar(ruta, {
      method: "GET",
      token: sesion.token,
    });
  } catch (error) {
    if ([502, 503, 504].includes(error?.status)) {
      await new Promise((resolver) => setTimeout(resolver, 700));

      return solicitar(ruta, {
        method: "GET",
        token: sesion.token,
      });
    }

    if (![401, 403].includes(error?.status)) {
      throw error;
    }

    sesionEnMemoria = null;
    sesion = await iniciarSesionCopecFuel();

    if (sesion.requiereCodigoEquipo) {
      const errorCodigo = new Error(
        "CopecFuel solicita validar nuevamente el equipo antes de sincronizar."
      );
      errorCodigo.requiereCodigoEquipo = true;
      throw errorCodigo;
    }

    return solicitar(ruta, {
      method: "GET",
      token: sesion.token,
    });
  }
}
