export function hoyChile() {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const partesFecha = Object.fromEntries(partes.filter(p => p.type !== "literal").map(p => [p.type, p.value]));
  return `${partesFecha.year}-${partesFecha.month}-${partesFecha.day}`;
}

function unico(valor) {
  if (valor === undefined) return "";
  if (typeof valor !== "string") return null;
  return valor.trim();
}

export function consultaOctano(query = {}) {
  // Solo período o un día exacto: evita búsquedas irrestrictas y respuestas incongruentes.
  const periodoEntrada = unico(query.periodo);
  const fecha = unico(query.fecha);
  if (periodoEntrada === null || fecha === null) {
    throw new Error("Los parámetros periodo y fecha deben ser únicos.");
  }
  if (fecha && !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(fecha)) {
    throw new Error("La fecha debe usar AAAA-MM-DD.");
  }
  if (fecha) {
    const fechareal = new Date(`${fecha}T12:00:00Z`);
    if (Number.isNaN(fechareal.getTime()) || fechareal.toISOString().slice(0, 10) !== fecha) {
      throw new Error("Fecha no válida.");
    }
  }
  const periodo = periodoEntrada || (fecha ? fecha.slice(0, 7) : hoyChile().slice(0, 7));
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodo)) {
    throw new Error("El período debe usar AAAA-MM.");
  }
  if (fecha && fecha.slice(0, 7) !== periodo) {
    throw new Error("La fecha consultada no coincide con el período.");
  }
  return { periodo, fecha: fecha || null };
}
