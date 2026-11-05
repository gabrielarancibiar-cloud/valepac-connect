// Presentación única de estados COSEDUCAM para portal y PWA.
export const ESTADOS_TAE = {
  RETIRO_TAE_OK: 'Retiro TAE OK',
  GUIA_EMITIDA_NO_CONFIRMADA: 'Pendiente de retiro',
  DIFERENCIA_LITROS: 'Diferencia de litros',
  SIN_GUIA_ENRUTA: 'Sin guía localizada',
  ENRUTA_NO_DISPONIBLE: 'En Ruta no disponible',
  ENRUTA_DATOS_INSUFICIENTES: 'Datos insuficientes',
  ENRUTA_ESTADO_NO_ACREDITADO: 'Estado por revisar',
  REVISION_MULTIPLES_GUIAS: 'Varias guías por revisar',
  REVISION_GUIA_REPETIDA: 'Guía repetida',
  DATOS_COPECFUEL_INCOMPLETOS: 'CopecFuel incompleto',
  DIA_EN_CURSO_O_SIN_GUIA: 'Día en curso',
};
export function categoriaSeguimiento(dia) {
  if (!dia) return 'informativo';
  if (['ok', 'pendiente', 'revisar', 'informativo'].includes(dia?.categoria)) return dia.categoria;
  if (dia?.estado === 'RETIRO_TAE_OK') return 'ok';
  if (dia?.estado === 'GUIA_EMITIDA_NO_CONFIRMADA') return 'pendiente';
  if (dia?.estado === 'DIA_EN_CURSO_O_SIN_GUIA') return 'informativo';
  return 'revisar';
}
export function tituloSeguimiento(dia) {
  return dia?.titulo || ESTADOS_TAE[dia?.estado] || 'Sin verificación';
}
export function fechaHoraEnRuta(valor) {
  if (!valor) return '—';
  const texto = String(valor).trim();
  // En Ruta entrega DD-MM-AAAA HH:mm:ss; conservar su hora local.
  if (/^\d{1,2}[-/]\d{1,2}[-/]\d{4}(?:\s|$)/.test(texto)) return texto;
  if (/^\d{4}-\d{2}-\d{2}/.test(texto)) {
    const [fecha, hora] = texto.split(/[T ]/);
    const [a, m, d] = fecha.split('-');
    return `${d}-${m}-${a}${hora ? ` ${hora.slice(0, 8)}` : ''}`;
  }
  return texto;
}
export function fechaAnteriorChile() {
  const hoy = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const valor = new Date(`${hoy}T12:00:00Z`);
  valor.setUTCDate(valor.getUTCDate() - 1);
  return valor.toISOString().slice(0, 10);
}
