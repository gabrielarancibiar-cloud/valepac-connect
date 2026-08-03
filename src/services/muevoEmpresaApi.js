async function leerRespuesta(respuesta) {
  const payload = await respuesta.json().catch(() => null);

  if (!respuesta.ok || !payload?.ok) {
    const error = new Error(
      payload?.error || `La solicitud fallo con estado ${respuesta.status}.`
    );
    error.status = respuesta.status;
    error.requiereCodigoEquipo =
      Boolean(payload?.requiereCodigoEquipo) ||
      /validar.*equipo|codigo.*equipo/i.test(error.message);
    throw error;
  }

  return payload;
}

function obtenerFechasDelMes(periodo) {
  const coincidencia = String(periodo || "").match(/^(\d{4})-(\d{2})$/);

  if (!coincidencia) return [];

  const anio = Number(coincidencia[1]);
  const mes = Number(coincidencia[2]);
  const diasMes = new Date(anio, mes, 0).getDate();
  const hoy = new Date();
  const periodoActual = `${hoy.getFullYear()}-${String(
    hoy.getMonth() + 1
  ).padStart(2, "0")}`;
  let ultimoDia = diasMes;

  if (periodo > periodoActual) return [];
  if (periodo === periodoActual) ultimoDia = hoy.getDate();

  return Array.from({ length: ultimoDia }, (_, indice) =>
    `${periodo}-${String(indice + 1).padStart(2, "0")}`
  );
}

function esperar(milisegundos) {
  return new Promise((resolver) => setTimeout(resolver, milisegundos));
}

async function sincronizarDiaMuevoEmpresa(fecha) {
  let ultimoError;

  for (let intento = 1; intento <= 2; intento += 1) {
    try {
      const respuesta = await fetch("/api/conciliacion/muevo-empresa", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          accion: "sincronizar_copecfuel",
          fecha,
        }),
      });

      return await leerRespuesta(respuesta);
    } catch (error) {
      ultimoError = error;

      if (
        error.requiereCodigoEquipo ||
        ![502, 503, 504].includes(error.status) ||
        intento === 2
      ) {
        throw error;
      }

      await esperar(700);
    }
  }

  throw ultimoError;
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

function normalizarRut(valor) {
  return String(valor || "")
    .replace(/[^0-9K]/gi, "")
    .toUpperCase();
}

function numeroCsv(valor) {
  const texto = String(valor || "")
    .trim()
    .replace(/\./g, "")
    .replace(",", ".");
  const resultado = Number(texto);
  return Number.isFinite(resultado) ? resultado : 0;
}

function fechaIso(valor) {
  const texto = String(valor || "").trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto;

  const coincidencia = texto.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return coincidencia
    ? `${coincidencia[3]}-${coincidencia[2]}-${coincidencia[1]}`
    : null;
}

function separarCsv(texto) {
  const filas = [];
  let fila = [];
  let celda = "";
  let entreComillas = false;

  for (let indice = 0; indice < texto.length; indice += 1) {
    const caracter = texto[indice];
    const siguiente = texto[indice + 1];

    if (caracter === '"' && entreComillas && siguiente === '"') {
      celda += '"';
      indice += 1;
    } else if (caracter === '"') {
      entreComillas = !entreComillas;
    } else if (caracter === ";" && !entreComillas) {
      fila.push(celda);
      celda = "";
    } else if ((caracter === "\n" || caracter === "\r") && !entreComillas) {
      if (caracter === "\r" && siguiente === "\n") indice += 1;
      fila.push(celda);

      if (fila.some((valor) => valor !== "")) filas.push(fila);
      fila = [];
      celda = "";
    } else {
      celda += caracter;
    }
  }

  if (celda || fila.length > 0) {
    fila.push(celda);
    if (fila.some((valor) => valor !== "")) filas.push(fila);
  }

  return filas;
}

function codigoEdsDesdeFila(fila, nombreArchivo) {
  const coincidenciaArchivo = String(nombreArchivo || "").match(
    /(?:^|_)(\d{4,6})(?:_|\.)/
  );

  if (coincidenciaArchivo) return coincidenciaArchivo[1];

  const coincidenciaTransaccion = String(
    fila["TRANSACCIÓN CÓDIGO"] || ""
  ).match(/^N(\d{5})/i);

  return coincidenciaTransaccion?.[1] || "";
}

export async function leerCsvMuevoEmpresa(archivo) {
  const texto = await archivo.text();
  const matriz = separarCsv(texto);

  if (matriz.length < 2) {
    throw new Error("El archivo no contiene ventas.");
  }

  const encabezados = matriz[0].map((valor, indice) =>
    indice === 0 ? String(valor).replace(/^\uFEFF/, "").trim() : String(valor).trim()
  );
  const obligatorias = [
    "TRANSACCIÓN ID",
    "TRANSACCIÓN CÓDIGO",
    "FECHA TRANSACCIÓN",
    "RUT EMISOR",
    "RAZON SOCIAL EMISOR",
    "FORMA PAGO",
    "TIPO DOCUMENTO",
    "DESCRIPCIÓN DOCUMENTO",
    "FOLIO",
    "TOTAL A PAGAR",
  ];
  const faltantes = obligatorias.filter(
    (encabezado) => !encabezados.includes(encabezado)
  );

  if (faltantes.length > 0) {
    throw new Error(`Faltan columnas requeridas: ${faltantes.join(", ")}.`);
  }

  const formasPermitidas = new Set([
    "EFECTIVO",
    "CREDITO",
    "DEBITO",
    "TARJETA DE CREDITO",
    "TARJETA DE DEBITO",
  ]);
  const ventas = new Map();

  for (const valores of matriz.slice(1)) {
    const fila = Object.fromEntries(
      encabezados.map((encabezado, indice) => [encabezado, valores[indice] || ""])
    );
    const rutEmisor = normalizarRut(fila["RUT EMISOR"]);
    const formaPago = normalizarTexto(fila["FORMA PAGO"]);
    const transaccionId = String(fila["TRANSACCIÓN ID"] || "").trim();
    const fecha = fechaIso(fila["FECHA TRANSACCIÓN"]);
    const montoBruto = numeroCsv(fila["TOTAL A PAGAR"]);
    const propina = numeroCsv(
      fila["TOTAL PROPINA"] || fila.PROPINA
    );
    const monto = Math.max(0, montoBruto - propina);

    if (
      rutEmisor !== "995200007" ||
      !formasPermitidas.has(formaPago) ||
      !transaccionId ||
      !fecha ||
      monto <= 0
    ) {
      continue;
    }

    if (!ventas.has(transaccionId)) {
      ventas.set(transaccionId, {
        transaccionId,
        transaccionCodigo: fila["TRANSACCIÓN CÓDIGO"],
        codigoEds: codigoEdsDesdeFila(fila, archivo.name),
        fecha,
        rutEmisor: fila["RUT EMISOR"],
        razonSocialEmisor: fila["RAZON SOCIAL EMISOR"],
        formaPago,
        tipoDocumento: fila["TIPO DOCUMENTO"],
        descripcionDocumento: fila["DESCRIPCIÓN DOCUMENTO"],
        folio: fila.FOLIO,
        montoBruto,
        propina,
        monto,
      });
    }
  }

  return [...ventas.values()];
}

export async function importarVentasMuevoEmpresa(archivo) {
  const ventas = await leerCsvMuevoEmpresa(archivo);
  const respuesta = await fetch("/api/conciliacion/muevo-empresa", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ventas }),
  });

  return leerRespuesta(respuesta);
}

export async function obtenerCargosMuevoEmpresa(periodo) {
  const params = new URLSearchParams({ periodo });
  const respuesta = await fetch(
    `/api/conciliacion/muevo-empresa?${params.toString()}`,
    {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    }
  );

  return leerRespuesta(respuesta);
}

export async function sincronizarMesMuevoEmpresa(periodo, onProgreso) {
  const fechas = obtenerFechasDelMes(periodo);

  if (fechas.length === 0) {
    throw new Error(
      "El mes seleccionado no tiene dias disponibles para sincronizar."
    );
  }

  const resultado = {
    total: fechas.length,
    completados: 0,
    ventasGuardadas: 0,
    montoGuardado: 0,
    totalPropinas: 0,
    errores: [],
  };

  for (const [indice, fecha] of fechas.entries()) {
    onProgreso?.({ actual: indice + 1, total: fechas.length, fecha });

    try {
      const dia = await sincronizarDiaMuevoEmpresa(fecha);
      resultado.completados += 1;
      resultado.ventasGuardadas += Number(dia.ventasGuardadas || 0);
      resultado.montoGuardado += Number(dia.montoGuardado || 0);
      resultado.totalPropinas += Number(dia.totalPropinas || 0);
    } catch (error) {
      if (error.requiereCodigoEquipo) {
        throw error;
      }

      resultado.errores.push({
        fecha,
        mensaje: error.message || "No fue posible sincronizar el dia.",
      });
    }
  }

  return resultado;
}
