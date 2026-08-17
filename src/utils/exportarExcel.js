const encoder = new TextEncoder();

const COLUMNAS_PRIORITARIAS = [
  "fuenteValepac",
  "fecha",
  "turnoId",
  "transaccionId",
  "transaccionCodigo",
  "transaccionTipo",
  "transaccionFechaCierre",
  "codigoEds",
  "posNumero",
  "surtidorId",
  "formaPagoId",
  "formaPagoNombre",
  "clienteRut",
  "clienteRazonSocial",
  "clienteRutRut",
  "clienteRutRazonSocial",
  "tipoDocumento",
  "descripcionDocumento",
  "folio",
  "categoriaNombre",
  "productoId",
  "productoDescripcion",
  "cantidad",
  "total",
  "totalDocumento",
  "totalMontoPagar",
  "totalPropina",
  "montoVuelto",
  "totalDescuentoPago",
];

function limpiarXml(valor) {
  return String(valor ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function esObjetoPlano(valor) {
  return (
    valor !== null &&
    typeof valor === "object" &&
    !Array.isArray(valor) &&
    !(valor instanceof Date)
  );
}

function aplanarObjeto(objeto, prefijo = "", resultado = {}) {
  for (const [clave, valor] of Object.entries(objeto || {})) {
    const nombre = prefijo ? `${prefijo}.${clave}` : clave;

    if (esObjetoPlano(valor)) {
      aplanarObjeto(valor, nombre, resultado);
    } else if (Array.isArray(valor)) {
      resultado[nombre] = JSON.stringify(valor);
    } else {
      resultado[nombre] = valor;
    }
  }

  return resultado;
}

function ordenarColumnas(filas) {
  const disponibles = new Set(filas.flatMap((fila) => Object.keys(fila)));
  const prioritarias = COLUMNAS_PRIORITARIAS.filter((campo) =>
    disponibles.delete(campo)
  );
  const restantes = [...disponibles].sort((a, b) =>
    a.localeCompare(b, "es", { sensitivity: "base" })
  );

  return [...prioritarias, ...restantes];
}

function nombreColumna(indice) {
  let numero = indice + 1;
  let nombre = "";

  while (numero > 0) {
    const resto = (numero - 1) % 26;
    nombre = String.fromCharCode(65 + resto) + nombre;
    numero = Math.floor((numero - 1) / 26);
  }

  return nombre;
}

function valorParaCelda(valor) {
  if (valor === null || valor === undefined) return { tipo: "texto", valor: "" };
  if (typeof valor === "number" && Number.isFinite(valor)) {
    return { tipo: "numero", valor };
  }
  if (typeof valor === "boolean") return { tipo: "booleano", valor };
  if (valor instanceof Date) return { tipo: "texto", valor: valor.toISOString() };
  if (typeof valor === "object") {
    return { tipo: "texto", valor: JSON.stringify(valor).slice(0, 32767) };
  }

  return { tipo: "texto", valor: String(valor).slice(0, 32767) };
}

function celdaXml(referencia, valor, estilo = 0) {
  const celda = valorParaCelda(valor);
  const estiloFinal =
    celda.tipo === "texto" && estilo !== 1 ? (estilo === 2 ? 4 : 3) : estilo;
  const atributoEstilo = estiloFinal ? ` s="${estiloFinal}"` : "";

  if (celda.tipo === "numero") {
    return `<c r="${referencia}"${atributoEstilo}><v>${celda.valor}</v></c>`;
  }

  if (celda.tipo === "booleano") {
    return `<c r="${referencia}" t="b"${atributoEstilo}><v>${
      celda.valor ? 1 : 0
    }</v></c>`;
  }

  return `<c r="${referencia}" t="inlineStr"${atributoEstilo}><is><t xml:space="preserve">${limpiarXml(
    celda.valor
  )}</t></is></c>`;
}

function anchoColumna(columna, filas) {
  const mayor = filas.reduce((ancho, fila) => {
    const valor = valorParaCelda(fila[columna]).valor;
    return Math.max(ancho, String(valor ?? "").length);
  }, columna.length);

  return Math.min(48, Math.max(11, mayor + 2));
}

function hojaXml(columnas, filas) {
  const ultimaColumna = nombreColumna(columnas.length - 1);
  const ultimaFila = filas.length + 1;
  const columnasXml = columnas
    .map(
      (columna, indice) =>
        `<col min="${indice + 1}" max="${indice + 1}" width="${anchoColumna(
          columna,
          filas
        )}" customWidth="1"/>`
    )
    .join("");
  const encabezado = columnas
    .map((columna, indice) => celdaXml(`${nombreColumna(indice)}1`, columna, 1))
    .join("");
  const cuerpo = filas
    .map((fila, indiceFila) => {
      const numeroFila = indiceFila + 2;
      const celdas = columnas
        .map((columna, indiceColumna) =>
          celdaXml(
            `${nombreColumna(indiceColumna)}${numeroFila}`,
            fila[columna],
            indiceFila % 2 === 1 ? 2 : 0
          )
        )
        .join("");

      return `<row r="${numeroFila}">${celdas}</row>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:${ultimaColumna}${ultimaFila}"/>
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>${columnasXml}</cols>
  <sheetData><row r="1" ht="22" customHeight="1">${encabezado}</row>${cuerpo}</sheetData>
  <autoFilter ref="A1:${ultimaColumna}${ultimaFila}"/>
</worksheet>`;
}

function tablaCrc32() {
  return Array.from({ length: 256 }, (_, indice) => {
    let crc = indice;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    return crc >>> 0;
  });
}

const CRC32 = tablaCrc32();

function calcularCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC32[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function uint16(valor) {
  return [valor & 0xff, (valor >>> 8) & 0xff];
}

function uint32(valor) {
  return [
    valor & 0xff,
    (valor >>> 8) & 0xff,
    (valor >>> 16) & 0xff,
    (valor >>> 24) & 0xff,
  ];
}

function crearZip(archivos) {
  const partesLocales = [];
  const partesCentrales = [];
  let desplazamiento = 0;

  for (const archivo of archivos) {
    const nombre = encoder.encode(archivo.nombre);
    const contenido = encoder.encode(archivo.contenido);
    const crc = calcularCrc32(contenido);
    const cabeceraLocal = new Uint8Array([
      ...uint32(0x04034b50),
      ...uint16(20),
      ...uint16(0x0800),
      ...uint16(0),
      ...uint16(0),
      ...uint16(0),
      ...uint32(crc),
      ...uint32(contenido.length),
      ...uint32(contenido.length),
      ...uint16(nombre.length),
      ...uint16(0),
    ]);
    const entradaLocal = new Blob([cabeceraLocal, nombre, contenido]);
    partesLocales.push(entradaLocal);

    const cabeceraCentral = new Uint8Array([
      ...uint32(0x02014b50),
      ...uint16(20),
      ...uint16(20),
      ...uint16(0x0800),
      ...uint16(0),
      ...uint16(0),
      ...uint16(0),
      ...uint32(crc),
      ...uint32(contenido.length),
      ...uint32(contenido.length),
      ...uint16(nombre.length),
      ...uint16(0),
      ...uint16(0),
      ...uint16(0),
      ...uint16(0),
      ...uint32(0),
      ...uint32(desplazamiento),
    ]);
    partesCentrales.push(new Blob([cabeceraCentral, nombre]));
    desplazamiento += cabeceraLocal.length + nombre.length + contenido.length;
  }

  const tamanoCentral = partesCentrales.reduce(
    (total, parte) => total + parte.size,
    0
  );
  const finDirectorio = new Uint8Array([
    ...uint32(0x06054b50),
    ...uint16(0),
    ...uint16(0),
    ...uint16(archivos.length),
    ...uint16(archivos.length),
    ...uint32(tamanoCentral),
    ...uint32(desplazamiento),
    ...uint16(0),
  ]);

  return new Blob([...partesLocales, ...partesCentrales, finDirectorio], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export function crearExcelTransacciones(transacciones, fecha) {
  const filas = (transacciones || []).map((fila) => aplanarObjeto(fila));

  if (filas.length === 0) {
    throw new Error("No hay transacciones para descargar.");
  }

  const columnas = ordenarColumnas(filas);
  const nombreHoja = `Ventas ${fecha || "CopecFuel"}`.slice(0, 31);
  const archivos = [
    {
      nombre: "[Content_Types].xml",
      contenido: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    },
    {
      nombre: "_rels/.rels",
      contenido: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      nombre: "xl/workbook.xml",
      contenido: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${limpiarXml(
        nombreHoja
      )}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      nombre: "xl/_rels/workbook.xml.rels",
      contenido: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    {
      nombre: "xl/styles.xml",
      contenido: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Aptos"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE5252A"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF7F8FA"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFD0D5DD"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="49" fontId="0" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    },
    {
      nombre: "xl/worksheets/sheet1.xml",
      contenido: hojaXml(columnas, filas),
    },
  ];

  return crearZip(archivos);
}

export function descargarExcelTransacciones(transacciones, fecha) {
  const archivo = crearExcelTransacciones(transacciones, fecha);
  const enlace = document.createElement("a");
  const url = URL.createObjectURL(archivo);

  enlace.href = url;
  enlace.download = `ventas_copecfuel_${fecha || "consulta"}.xlsx`;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
