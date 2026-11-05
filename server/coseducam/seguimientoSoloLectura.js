// Seguimiento COSEDUCAM exclusivamente de lectura: CopecFuel + reporte En Ruta.
// Este modulo NO autoriza, emite, confirma ni modifica guias.
import { clasificarConsumosV2 } from './comercialV2.js';

export const EDS = '40098';
const RUT_COSEDUCAM = '969636301';
// Estados terminales acreditados operacionalmente para En Ruta (05-11-2026).
const ESTADOS_FINALES = new Set([
  'CERRADO', 'ENTREGADO',
  'CONFIRMADA', 'CONFIRMADO', 'RETIRO CONFIRMADO',
  'GUIA CONFIRMADA', 'CONFIRMADO EN RUTA', 'CONFIRMADA EN RUTA',
]);

const texto = (valor) => String(valor ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .trim().toUpperCase().replace(/\s+/g, ' ');
const rut = (valor) => texto(valor).replace(/[^0-9K]/g, '');
const campo = (fila, nombres) => nombres.map((nombre) => fila[nombre])
  .find((valor) => String(valor ?? '').trim()) ?? '';
const redondear3 = (valor) => Math.round(valor * 1000) / 1000;

function fechaIso(valor) {
  const valorTexto = String(valor ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(valorTexto)) return valorTexto.slice(0, 10);
  const partes = valorTexto.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  return partes ? `${partes[3]}-${partes[2].padStart(2, '0')}-${partes[1].padStart(2, '0')}` : null;
}

function litrosChile(valor) {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  const original = String(valor ?? '').trim().replace(/\s/g, '');
  if (!original) return null;
  const normalizado = original.includes(',')
    ? original.replace(/\./g, '').replace(',', '.')
    : original.replace(/(?<=\d)\.(?=\d{3}(?:\D|$))/g, '');
  const numero = Number(normalizado);
  return Number.isFinite(numero) && numero >= 0 ? numero : null;
}

export function redondearLitros(valor) {
  const numero = Number(valor);
  return Number.isFinite(numero) && numero >= 0
    ? Math.floor(redondear3(numero) + 0.5)
    : null;
}

export function parsearExcelEnRutaTsv(contenido) {
  const lineas = String(contenido ?? '').replace(/^\uFEFF/, '')
    .split(/\r?\n/).filter((linea) => linea.trim());
  if (lineas.length === 0) return { columnas: [], filas: [] };
  const columnas = lineas[0].split('\t').map(texto);
  return {
    columnas,
    filas: lineas.slice(1).map((linea) => {
      const valores = linea.split('\t');
      return Object.fromEntries(columnas.map((nombre, i) => [nombre, (valores[i] ?? '').trim()]));
    }),
  };
}

export function normalizarGuiaEnRuta(fila) {
  // FECHA CREACION vincula el pedido con el dia; FECHA ESTADO puede ser posterior.
  const fechaOrigen = fechaIso(campo(fila, [
    'FECHA CREACION', 'FECHA CREACIÓN', 'FECHA AUTORIZACION',
    'FECHA AUTORIZACIÓN', 'FECHA EMISION', 'FECHA EMISIÓN',
    'FECHA PEDIDO', 'FECHA INGRESO',
  ]));
  const fechaEstado = String(campo(fila, ['FECHA ESTADO'])).trim() || null;
  const rutCliente = rut(campo(fila, [
    'RUT', 'RUT CLIENTE', 'RUT DESTINATARIO', 'RUT EMPRESA',
  ]));
  const destinatario = texto(campo(fila, [
    'DESTINATARIO', 'CLIENTE', 'RAZON SOCIAL',
    'RAZÓN SOCIAL', 'RAZON SOCIAL CLIENTE',
  ]));
  const clienteTae = texto(campo(fila, ['CLIENTE TAE']));
  const estacion = String(campo(fila, [
    'ESTACION', 'ESTACIÓN', 'ESTACION ORIGEN', 'ID ESTACION', 'CODIGO EDS',
  ])).trim();
  const estacionValida = !estacion || estacion.replace(/[^0-9]/g, '') === EDS;
  const nombreValido = destinatario.includes('COSEDUCAM') || clienteTae.includes('COSEDUCAM');
  // Nunca aceptar un RUT incorrecto aunque el nombre contenga COSEDUCAM.
  const clienteValido = estacionValida &&
    (!rutCliente || rutCliente === RUT_COSEDUCAM) &&
    (rutCliente === RUT_COSEDUCAM || nombreValido) &&
    (!destinatario || destinatario.includes('COSEDUCAM'));
  const producto = texto(campo(fila, [
    'PRODUCTO', 'DESCRIPCION PRODUCTO', 'DESCRIPCIÓN PRODUCTO',
  ]));
  const productoValido = ['D', 'DIESEL', 'PETROLEO DIESEL', 'DIESEL A1'].includes(producto);
  const estado = texto(campo(fila, ['ESTADO', 'ESTADO PEDIDO', 'ESTADO ENTREGA']));
  const numeroGuiaTae = String(campo(fila, [
    'GUIA TAE', 'GUÍA TAE', 'GUIA', 'NUMERO GUIA',
    'NRO GUIA', 'N GUIA', 'N° GUIA', 'GUIA DESPACHO',
  ])).trim();
  const dte = String(campo(fila, ['DTE'])).trim();
  // DTE es la referencia visible en el reporte cuando no hay GUIA TAE; solo
  // puede acreditarse junto a identidad, fecha, diesel, estado y litros.
  const guia = numeroGuiaTae || dte;
  const pedido = String(campo(fila, ['NUMERO PEDIDO', 'NRO PEDIDO', 'PEDIDO'])).trim();
  return {
    fechaOrigen, fechaEstado, clienteValido, productoValido,
    estado, final: ESTADOS_FINALES.has(estado),
    guia, pedido, dte, origenNumero: numeroGuiaTae ? 'GUIA_TAE' : (dte ? 'DTE' : null),
    litros: litrosChile(campo(fila, ['LITROS ENTREGADOS', 'VOLUMEN ENTREGADO', 'LITROS', 'VOLUMEN'])),
    litrosSolicitados: litrosChile(campo(fila, ['LITROS SOLICITADOS', 'VOLUMEN SOLICITADO'])),
  };
}

const etiquetas = {
  RETIRO_TAE_OK: ['ok', 'Retiro TAE OK', 'Guía finalizada en En Ruta y litros conciliados con CopecFuel.'],
  GUIA_EMITIDA_NO_CONFIRMADA: ['pendiente', 'Pendiente de retiro', 'La guía existe, pero En Ruta todavía no registra un estado final.'],
  DIFERENCIA_LITROS: ['revisar', 'Diferencia de litros', 'El volumen finalizado en En Ruta no coincide con los litros enteros esperados.'],
  SIN_GUIA_ENRUTA: ['revisar', 'Sin guía localizada', 'No se encontró una guía COSEDUCAM asociada a este día.'],
  ENRUTA_NO_DISPONIBLE: ['revisar', 'En Ruta no disponible', 'No fue posible verificar el reporte externo.'],
  ENRUTA_DATOS_INSUFICIENTES: ['revisar', 'Datos insuficientes', 'La guía no contiene todos los campos necesarios para acreditarla.'],
  ENRUTA_ESTADO_NO_ACREDITADO: ['revisar', 'Estado por revisar', 'En Ruta devolvió un estado que no se ha clasificado como final o pendiente.'],
  REVISION_MULTIPLES_GUIAS: ['revisar', 'Varias guías por revisar', 'Hay referencias repetidas o información inconsistente entre guías.'],
  REVISION_GUIA_REPETIDA: ['revisar', 'Guía repetida', 'Una guía figura más de una vez para este día; requiere revisión.'],
  DATOS_COPECFUEL_INCOMPLETOS: ['revisar', 'CopecFuel incompleto', 'Los datos comerciales del día requieren revisión.'],
  DIA_EN_CURSO_O_SIN_GUIA: ['informativo', 'Día en curso', 'La fecha seleccionada aún no ha completado el cierre operacional.'],
};

export function conciliarCoseducam({ periodo, consumos, filasEnRuta, enRutaDisponible = true, ahora = new Date(), codigoEds = EDS }) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodo)) throw new Error('Periodo inválido');
  const diasMes = new Date(Date.UTC(Number(periodo.slice(0, 4)), Number(periodo.slice(5)), 0)).getUTCDate();
  const hoyChile = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(ahora);
  const consumosValidos = Array.isArray(consumos) ? consumos : [];
  const reporte = (Array.isArray(filasEnRuta) ? filasEnRuta : []).map(normalizarGuiaEnRuta);
  const dias = [];
  for (let n = 1; n <= diasMes; n++) {
    const fecha = `${periodo}-${String(n).padStart(2, '0')}`;
    if (fecha > hoyChile) break;
    const comercial = clasificarConsumosV2(fecha, consumosValidos.filter((r) => r.fecha === fecha));
    if (comercial.litros <= 0 && comercial.registros === 0) continue;
    const esperados = redondearLitros(comercial.litros);
    const candidatos = reporte.filter((g) => g.clienteValido && g.productoValido && g.fechaOrigen === fecha);
    const identificados = candidatos.filter((g) => g.guia);
    const numeros = new Set(identificados.map((g) => g.guia));
    const repetidas = identificados.length !== numeros.size;
    const finales = identificados.filter((g) => g.final);
    const pendientes = identificados.filter((g) => !g.final);
    const sumaFinal = finales.length && finales.every((g) => g.litros !== null)
      ? redondear3(finales.reduce((total, g) => total + g.litros, 0))
      : null;
    const sumaTodos = identificados.length && identificados.every((g) => g.litros !== null)
      ? redondear3(identificados.reduce((total, g) => total + g.litros, 0))
      : null;
    const todosFinales = identificados.length > 0 && pendientes.length === 0;
    const coinciden = todosFinales && sumaFinal !== null && Math.abs(sumaFinal - esperados) <= 0.01;
    let estado = 'SIN_GUIA_ENRUTA';
    if (!enRutaDisponible) estado = 'ENRUTA_NO_DISPONIBLE';
    else if (!comercial.completo) estado = 'DATOS_COPECFUEL_INCOMPLETOS';
    else if (repetidas) estado = 'REVISION_GUIA_REPETIDA';
    else if (coinciden) estado = 'RETIRO_TAE_OK';
    else if (todosFinales && sumaFinal !== null) estado = 'DIFERENCIA_LITROS';
    else if (todosFinales) estado = 'ENRUTA_DATOS_INSUFICIENTES';
    else if (!identificados.length && candidatos.length && candidatos.every((g) =>
      g.pedido && g.estado.startsWith('PENDIENTE'))) estado = 'GUIA_EMITIDA_NO_CONFIRMADA';
    else if (candidatos.some((g) => !g.guia)) estado = 'ENRUTA_DATOS_INSUFICIENTES';
    else if (pendientes.length) {
      estado = pendientes.every((g) => g.estado && (
        g.estado.startsWith('PENDIENTE') ||
        ['EMITIDA', 'EMITIDO', 'CREADA', 'CREADO', 'EN PROCESO', 'ENVIADO'].includes(g.estado)
      )) ? 'GUIA_EMITIDA_NO_CONFIRMADA' : 'ENRUTA_ESTADO_NO_ACREDITADO';
    }
    else if (reporte.some((g) => g.clienteValido && g.productoValido && !g.fechaOrigen))
      estado = 'ENRUTA_DATOS_INSUFICIENTES';
    else if (fecha === hoyChile) estado = 'DIA_EN_CURSO_O_SIN_GUIA';

    const [categoria, titulo, motivo] = etiquetas[estado];
    const sumaGuia = todosFinales ? sumaFinal : sumaTodos;
    const diferenciaLitros = todosFinales && sumaFinal !== null
      ? redondear3(sumaFinal - comercial.litros)
      : null;
    const diferenciaEnteros = todosFinales && sumaFinal !== null
      ? redondear3(sumaFinal - esperados)
      : null;
    const guias = candidatos.filter((g) => g.guia || g.pedido).map((g) => ({
      numeroGuia: g.guia, numeroPedido: g.pedido || null, origenNumero: g.origenNumero,
      estadoEnRuta: g.estado, fechaEstado: g.fechaEstado,
      litros: g.litros, litrosSolicitados: g.litrosSolicitados,
    }));
    const primeraGuia = guias[0] || null;
    dias.push({
      fecha, estado, categoria, titulo, motivo,
      consumo: {
        litros: comercial.litros, litrosEsperados: esperados,
        precioTae: comercial.precioTae, cargas: comercial.registros,
        datosCompletos: comercial.completo,
        detalle: comercial.elegibles.map((r) => ({
          transaccion: r.transaccion_codigo || r.transaccion_id,
          litros: Number(r.litros) || 0, patente: r.patente || null,
        })),
      },
      guia: primeraGuia, guias,
      conciliacion: {
        litrosEnRuta: sumaGuia,
        diferenciaLitros,
        diferenciaEnteros,
        litrosCoinciden: estado === 'RETIRO_TAE_OK',
        resultadoComparacion: todosFinales
          ? (coinciden ? 'COINCIDE' : sumaFinal === null ? 'NO_VERIFICABLE' : 'NO_COINCIDE')
          : identificados.length ? 'PENDIENTE' : 'NO_VERIFICABLE',
        regla: 'Litros CopecFuel redondeados al entero, fracción 0,5 hacia arriba.',
      },
      candidatas: candidatos.length,
      observacion: motivo,
    });
  }
  return {
    periodo, codigoEds,
    fuentes: {
      copecfuel: 'COPECFUEL_DATALAKE_STORAGE',
      enRuta: enRutaDisponible ? 'ENRUTA_EXCEL_SOLO_LECTURA' : 'ENRUTA_NO_DISPONIBLE',
    },
    resumen: {
      litros: redondear3(dias.reduce((total, d) => total + d.consumo.litros, 0)),
      cargas: dias.reduce((total, d) => total + d.consumo.cargas, 0),
      diasConConsumo: dias.length,
      retirosOk: dias.filter((d) => d.estado === 'RETIRO_TAE_OK').length,
      emitidasSinConfirmar: dias.filter((d) => d.categoria === 'pendiente').length,
      requierenRevision: dias.filter((d) => d.categoria === 'revisar').length,
    },
    dias, soloLectura: true,
  };
}
