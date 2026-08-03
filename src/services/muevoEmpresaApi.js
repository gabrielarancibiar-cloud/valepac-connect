async function leerRespuesta(respuesta) {
  const payload = await respuesta.json().catch(() => null);

  if (!respuesta.ok || !payload?.ok) {
    throw new Error(
      payload?.error || `La solicitud fallo con estado ${respuesta.status}.`
    );
  }

  return payload;
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
