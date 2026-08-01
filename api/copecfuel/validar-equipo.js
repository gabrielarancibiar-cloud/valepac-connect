import { validarCodigoEquipoCopecFuel } from "./client.js";

function escaparHtml(valor) {
  return String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function paginaFormulario(mensaje = "", esError = false) {
  const color = esError ? "#b42318" : "#16794f";

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Validar CopecFuel</title>
    <style>
      body { margin: 0; padding: 32px; background: #f4f6f8; color: #172033; font-family: Arial, sans-serif; }
      main { max-width: 480px; margin: 48px auto; padding: 28px; background: #fff; border: 1px solid #e4e7ec; border-radius: 14px; }
      h1 { margin-top: 0; }
      p { color: #667085; line-height: 1.5; }
      .mensaje { color: ${color}; font-weight: 700; }
      label { display: block; margin: 22px 0 8px; font-weight: 700; }
      input { width: 100%; padding: 12px; border: 1px solid #cfd4dc; border-radius: 8px; box-sizing: border-box; font-size: 18px; }
      button { width: 100%; margin-top: 16px; padding: 12px; border: 0; border-radius: 8px; background: #dc2626; color: #fff; font-weight: 700; cursor: pointer; }
    </style>
  </head>
  <body>
    <main>
      <h1>Validar equipo CopecFuel</h1>
      <p>Ingresa el codigo que CopecFuel envio al correo asociado a la cuenta.</p>
      ${mensaje ? `<p class="mensaje">${escaparHtml(mensaje)}</p>` : ""}
      <form method="post">
        <label for="codigo">Codigo de validacion</label>
        <input id="codigo" name="codigo" required maxlength="8" autocomplete="one-time-code" placeholder="e6 3a 7b" />
        <button type="submit">Validar equipo</button>
      </form>
    </main>
  </body>
</html>`;
}

function obtenerCodigo(request) {
  if (typeof request.body === "string") {
    return new URLSearchParams(request.body).get("codigo") || "";
  }

  return request.body?.codigo || "";
}

function solicitaJson(request) {
  const accept = String(request.headers?.accept || "");
  const contentType = String(request.headers?.["content-type"] || "");

  return (
    accept.includes("application/json") ||
    contentType.includes("application/json")
  );
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  const responderJson = solicitaJson(request);

  if (request.method === "GET") {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    return response.status(200).send(paginaFormulario());
  }

  if (request.method !== "POST") {
    if (responderJson) {
      return response.status(405).json({
        ok: false,
        error: "Metodo no permitido.",
      });
    }

    response.setHeader("Content-Type", "text/html; charset=utf-8");
    return response.status(405).send(
      paginaFormulario("Metodo no permitido.", true)
    );
  }

  try {
    const sesion = await validarCodigoEquipoCopecFuel(obtenerCodigo(request));

    if (responderJson) {
      return response.status(200).json({
        ok: true,
        conectado: true,
        mensaje: "Equipo validado correctamente. CopecFuel ya esta conectado.",
        ubicaciones: sesion.ubicaciones || [],
      });
    }

    response.setHeader("Content-Type", "text/html; charset=utf-8");
    return response.status(200).send(
      paginaFormulario(
        "Equipo validado correctamente. CopecFuel ya esta conectado."
      )
    );
  } catch (error) {
    console.error("Error validando equipo CopecFuel:", error);

    if (responderJson) {
      return response.status(error?.status || 500).json({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "No fue posible validar el equipo.",
      });
    }

    response.setHeader("Content-Type", "text/html; charset=utf-8");
    return response.status(error?.status || 500).send(
      paginaFormulario(
        error instanceof Error
          ? error.message
          : "No fue posible validar el equipo.",
        true
      )
    );
  }
}
