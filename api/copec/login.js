import { createHash, randomBytes } from "node:crypto";

const COPEC_AUTH_URL =
  process.env.COPEC_AUTH_URL || "https://copec-sa.fusionauth.io";
const COPEC_CLIENT_ID =
  process.env.COPEC_CLIENT_ID || "1617b374-b63f-4e7e-9aee-f7b4bd470378";
const COPEC_REDIRECT_URI =
  process.env.COPEC_REDIRECT_URI ||
  "https://portalconcesionarios.copec.cl/auth/callback";
const COPEC_SCOPE = process.env.COPEC_SCOPE || "openid";

const MARGEN_EXPIRACION_MS = 60_000;
const MAX_REDIRECCIONES = 8;

let tokenEnMemoria = null;
let tokenEnMemoriaExpiraEn = 0;

function base64Url(buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function crearCodeVerifier() {
  return base64Url(randomBytes(64));
}

function crearCodeChallenge(codeVerifier) {
  return base64Url(createHash("sha256").update(codeVerifier).digest());
}

function decodificarEntidadHtml(valor) {
  return String(valor ?? "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, numero) =>
      String.fromCodePoint(Number(numero))
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, numero) =>
      String.fromCodePoint(Number.parseInt(numero, 16))
    );
}

function obtenerAtributoHtml(etiqueta, nombre) {
  const patron = new RegExp(
    `(?:^|\\s)${nombre}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i"
  );
  const coincidencia = etiqueta.match(patron);

  return decodificarEntidadHtml(
    coincidencia?.[1] ?? coincidencia?.[2] ?? coincidencia?.[3] ?? ""
  );
}

function extraerFormularioLogin(html, urlActual) {
  const formulario = html.match(/<form\b[^>]*>/i)?.[0] || "";
  const accion = obtenerAtributoHtml(formulario, "action");
  const campos = new URLSearchParams();

  for (const coincidencia of html.matchAll(/<input\b[^>]*>/gi)) {
    const etiqueta = coincidencia[0];
    const nombre = obtenerAtributoHtml(etiqueta, "name");

    if (!nombre || nombre === "loginId" || nombre === "password") {
      continue;
    }

    const tipo = obtenerAtributoHtml(etiqueta, "type").toLowerCase();
    const esCheckbox = tipo === "checkbox" || tipo === "radio";
    const estaMarcado = /\schecked(?:\s|=|>)/i.test(etiqueta);

    if (esCheckbox && !estaMarcado) {
      continue;
    }

    campos.append(nombre, obtenerAtributoHtml(etiqueta, "value"));
  }

  return {
    action: new URL(accion || "/oauth2/authorize", urlActual).toString(),
    campos,
  };
}

function separarSetCookie(valor) {
  if (!valor) {
    return [];
  }

  return valor.split(
    /,(?=\s*[!#$%&'*+.^_`|~0-9A-Za-z-]+=)/g
  );
}

function guardarCookies(cookieJar, respuesta) {
  const setCookies =
    typeof respuesta.headers.getSetCookie === "function"
      ? respuesta.headers.getSetCookie()
      : separarSetCookie(respuesta.headers.get("set-cookie"));

  for (const setCookie of setCookies) {
    const primeraParte = setCookie.split(";", 1)[0];
    const separador = primeraParte.indexOf("=");

    if (separador <= 0) {
      continue;
    }

    const nombre = primeraParte.slice(0, separador).trim();
    const valor = primeraParte.slice(separador + 1).trim();
    const eliminada =
      /(?:^|;)\s*max-age=0(?:;|$)/i.test(setCookie) || valor === "";

    if (eliminada) {
      cookieJar.delete(nombre);
    } else {
      cookieJar.set(nombre, valor);
    }
  }
}

function crearCookieHeader(cookieJar) {
  return Array.from(cookieJar.entries())
    .map(([nombre, valor]) => `${nombre}=${valor}`)
    .join("; ");
}

async function fetchConCookies(url, opciones, cookieJar) {
  const headers = new Headers(opciones?.headers || {});
  const cookies = crearCookieHeader(cookieJar);

  if (cookies) {
    headers.set("Cookie", cookies);
  }

  const respuesta = await fetch(url, {
    ...opciones,
    headers,
    redirect: "manual",
  });

  guardarCookies(cookieJar, respuesta);
  return respuesta;
}

function esRedireccion(estado) {
  return estado >= 300 && estado < 400;
}

async function abrirPaginaAutorizacion(urlInicial, cookieJar) {
  let urlActual = urlInicial;

  for (let intento = 0; intento <= MAX_REDIRECCIONES; intento += 1) {
    const respuesta = await fetchConCookies(
      urlActual,
      {
        method: "GET",
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "es-CL,es;q=0.9,en;q=0.8",
        },
      },
      cookieJar
    );

    if (!esRedireccion(respuesta.status)) {
      return { respuesta, urlActual };
    }

    const location = respuesta.headers.get("location");

    if (!location) {
      throw new Error("FusionAuth redirigió sin indicar un destino.");
    }

    urlActual = new URL(location, urlActual).toString();
  }

  throw new Error("FusionAuth excedió el límite de redirecciones.");
}

function clasificarPaginaDeLogin(html) {
  if (/two.factor|multi.factor|verification code|authenticator|\bmfa\b/i.test(html)) {
    return "FusionAuth solicitó un segundo factor. El acceso automático requiere una cuenta sin MFA interactivo.";
  }

  if (/captcha/i.test(html) && !/name=["']captcha_token["'][^>]*value=["']["']/i.test(html)) {
    return "FusionAuth solicitó un CAPTCHA y no puede completarse automáticamente.";
  }

  if (/invalid login|invalid password|invalid credentials|login failed/i.test(html)) {
    return "FusionAuth rechazó el usuario o la contraseña de Copec.";
  }

  return "FusionAuth no completó el inicio de sesión. Revisa las credenciales o si el portal solicita una verificación adicional.";
}

async function extraerCodigoDeRedirecciones(
  respuestaInicial,
  urlInicial,
  cookieJar,
  stateEsperado
) {
  let respuesta = respuestaInicial;
  let urlActual = urlInicial;

  for (let intento = 0; intento <= MAX_REDIRECCIONES; intento += 1) {
    if (!esRedireccion(respuesta.status)) {
      const html = await respuesta.text();
      throw new Error(clasificarPaginaDeLogin(html));
    }

    const location = respuesta.headers.get("location");

    if (!location) {
      throw new Error("FusionAuth redirigió sin entregar el código OAuth.");
    }

    const siguienteUrl = new URL(location, urlActual);

    if (
      siguienteUrl.origin === new URL(COPEC_REDIRECT_URI).origin &&
      siguienteUrl.pathname === new URL(COPEC_REDIRECT_URI).pathname
    ) {
      const errorOauth = siguienteUrl.searchParams.get("error");
      const stateRecibido = siguienteUrl.searchParams.get("state");
      const codigo = siguienteUrl.searchParams.get("code");

      if (errorOauth) {
        throw new Error(`FusionAuth rechazó la autorización: ${errorOauth}.`);
      }

      if (!stateRecibido || stateRecibido !== stateEsperado) {
        throw new Error("FusionAuth devolvió un state OAuth no válido.");
      }

      if (!codigo) {
        throw new Error("FusionAuth no devolvió el código OAuth.");
      }

      return codigo;
    }

    urlActual = siguienteUrl.toString();
    respuesta = await fetchConCookies(
      urlActual,
      {
        method: "GET",
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "es-CL,es;q=0.9,en;q=0.8",
        },
      },
      cookieJar
    );
  }

  throw new Error("FusionAuth excedió el límite de redirecciones del login.");
}

function leerExpiracionJwt(token) {
  try {
    const payloadBase64 = token.split(".")[1];

    if (!payloadBase64) {
      return 0;
    }

    const payload = JSON.parse(
      Buffer.from(payloadBase64, "base64url").toString("utf8")
    );

    return Number(payload.exp) > 0 ? Number(payload.exp) * 1000 : 0;
  } catch {
    return 0;
  }
}

function guardarTokenEnMemoria(token, expiresIn) {
  const expiracionJwt = leerExpiracionJwt(token);
  const expiracionCalculada =
    Date.now() + Math.max(Number(expiresIn) || 300, 60) * 1000;

  tokenEnMemoria = token;
  tokenEnMemoriaExpiraEn = expiracionJwt || expiracionCalculada;
}

export function obtenerTokenCopecActual() {
  if (
    tokenEnMemoria &&
    tokenEnMemoriaExpiraEn > Date.now() + MARGEN_EXPIRACION_MS
  ) {
    return tokenEnMemoria;
  }

  tokenEnMemoria = null;
  tokenEnMemoriaExpiraEn = 0;
  return process.env.COPEC_TOKEN || null;
}

export async function iniciarSesionCopec() {
  const usuario = process.env.COPEC_USUARIO || process.env.COPEC_EMAIL;
  const password = process.env.COPEC_PASSWORD;

  if (!usuario || !password) {
    throw new Error(
      "Faltan COPEC_USUARIO (o COPEC_EMAIL) y COPEC_PASSWORD en Vercel."
    );
  }

  const codeVerifier = crearCodeVerifier();
  const codeChallenge = crearCodeChallenge(codeVerifier);
  const state = base64Url(randomBytes(24));
  const cookieJar = new Map();

  const authorizeUrl = new URL("/oauth2/authorize", COPEC_AUTH_URL);
  authorizeUrl.searchParams.set("client_id", COPEC_CLIENT_ID);
  authorizeUrl.searchParams.set("redirect_uri", COPEC_REDIRECT_URI);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("response_mode", "query");
  authorizeUrl.searchParams.set("scope", COPEC_SCOPE);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");

  const paginaLogin = await abrirPaginaAutorizacion(
    authorizeUrl.toString(),
    cookieJar
  );

  if (!paginaLogin.respuesta.ok) {
    throw new Error(
      `No fue posible abrir FusionAuth (estado ${paginaLogin.respuesta.status}).`
    );
  }

  const htmlLogin = await paginaLogin.respuesta.text();
  const formulario = extraerFormularioLogin(htmlLogin, paginaLogin.urlActual);

  formulario.campos.set("loginId", usuario);
  formulario.campos.set("password", password);
  formulario.campos.set("__cb_rememberDevice", "false");
  formulario.campos.set("rememberDevice", "true");

  const respuestaLogin = await fetchConCookies(
    formulario.action,
    {
      method: "POST",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "es-CL,es;q=0.9,en;q=0.8",
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: new URL(COPEC_AUTH_URL).origin,
        Referer: paginaLogin.urlActual,
      },
      body: formulario.campos.toString(),
    },
    cookieJar
  );

  const codigo = await extraerCodigoDeRedirecciones(
    respuestaLogin,
    formulario.action,
    cookieJar,
    state
  );

  const tokenUrl = new URL("/oauth2/token", COPEC_AUTH_URL);
  const tokenBody = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: COPEC_CLIENT_ID,
    code: codigo,
    code_verifier: codeVerifier,
    redirect_uri: COPEC_REDIRECT_URI,
  });

  const respuestaToken = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: tokenBody.toString(),
    redirect: "manual",
  });

  const textoToken = await respuestaToken.text();
  let payloadToken;

  try {
    payloadToken = JSON.parse(textoToken);
  } catch {
    throw new Error("FusionAuth respondió con un token en formato no válido.");
  }

  if (!respuestaToken.ok || !payloadToken?.access_token) {
    const errorOauth = payloadToken?.error || `HTTP ${respuestaToken.status}`;
    throw new Error(`FusionAuth no pudo emitir el access_token: ${errorOauth}.`);
  }

  guardarTokenEnMemoria(payloadToken.access_token, payloadToken.expires_in);

  return {
    accessToken: payloadToken.access_token,
    tokenType: payloadToken.token_type || "Bearer",
    expiresAt: tokenEnMemoriaExpiraEn,
  };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");

  if (request.method !== "POST") {
    return response.status(405).json({
      ok: false,
      error: "Método no permitido. Usa POST.",
    });
  }

  try {
    const sesion = await iniciarSesionCopec();

    return response.status(200).json({
      ok: true,
      mensaje: "Token Copec obtenido correctamente.",
      tokenObtenido: true,
      tokenType: sesion.tokenType,
      expiraEn: sesion.expiresAt
        ? new Date(sesion.expiresAt).toISOString()
        : null,
    });
  } catch (error) {
    console.error("Error iniciando sesión en Copec:", error);

    return response.status(500).json({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "No fue posible iniciar sesión en Copec.",
    });
  }
}
