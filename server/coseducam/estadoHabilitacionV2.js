// Diagnóstico púro, sin escritura ni operaciones externas.
// Estas comprobaciones NO sustituyen los controles de emisión en PostgreSQL.
export function evaluarEstadoTaeV2({ fecha, fechaChile, horaChile, flagTae, comercial, cierre, preparacion }) {
  const flags = {
    vercelTae: flagTae === true,
    fechaOperacional: fecha === fechaChile && fecha >= "2026-10-15",
    horaDesdeCorte: typeof horaChile === "string" && horaChile >= "23:50:00",
    consumosValidos: comercial?.ok === true && Number(comercial.litros) > 0 &&
      Number(comercial.precioMaximoTae) > 0,
    cierreAcreditado: cierre?.ok === true,
    preparacionLista: ["LISTA_PARA_PREPARAR", "PREPARADA"].includes(preparacion?.estadoControl),
  };
  const mensajes = {
    vercelTae: "Vercel tiene COSEDUCAM_TAE_V2_HABILITADA desactivada en este deployment.",
    fechaOperacional: "Solo se pueden emitir guías del día operacional vigente.",
    horaDesdeCorte: "Todavía no son las 23:50 en Chile.",
    consumosValidos: `Consumos no acreditados: ${comercial?.estado || "SIN_DATOS"}.`,
    cierreAcreditado: `Data Lake no acredita el cierre: ${cierre?.estado || "SIN_CONTROL"}.`,
    preparacionLista: `Preparación V2 no lista: ${preparacion?.estadoControl || "SIN_PREVISUALIZACION"}.`,
  };
  const bloqueos = Object.entries(flags).filter(([, habilitado]) => !habilitado)
    .map(([codigo]) => ({ codigo, detalle: mensajes[codigo] }));
  return { flags, bloqueos, listoParaSolicitarTae: bloqueos.length === 0 };
}
