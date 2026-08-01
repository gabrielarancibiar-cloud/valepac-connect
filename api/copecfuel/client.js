const COPECFUEL_API_URL =
  process.env.COPECFUEL_API_URL || "https://api2pr.copecfuel.com";

const TIMEOUT_MS = 30_000;

let sesionEnMemoria = null;

function textoSeguro(valor) {
  return typeof valor === "string" ? valor.trim() : "";
}

function leerBandera(data, nombreSnake, nombreCamel) {
  const valor = data?.[nombreSnake] ?? data?.[nombreCamel];
  return valor === true || valor === 1 || valor === "1";
}

function extraerMensaje(payload, estado) {
  return (
    payload?.userMessage ||
    payload?.message ||
    payload?.error ||
    payload?.data?.message ||
    `CopecFuel respondio con estado ${estado}.`
  );
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
  return sesion;
}

export async function obtenerSesionCopecFuel() {
  if (sesionEnMemoria?.token) {
    return sesionEnMemoria;
  }

  return iniciarSesionCopecFuel();
}

export async function consultarCopecFuel(ruta, sesion) {
  return solicitar(ruta, {
    method: "GET",
    token: sesion.token,
  });
}

