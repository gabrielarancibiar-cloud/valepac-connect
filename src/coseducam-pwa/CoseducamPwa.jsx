import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, LogOut, RefreshCw, CheckCircle2, AlertCircle, Clock3, Info } from 'lucide-react';
import { obtenerCoseducam } from '../services/coseducamApi.js';
import { categoriaSeguimiento, fechaAnteriorChile, fechaHoraEnRuta, tituloSeguimiento } from '../utils/coseducamSeguimiento.js';

const formatoLitros = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 3 });
const formatoPrecio = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });
const fechaHoy = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
const litros = (valor) => valor == null ? '—' : `${formatoLitros.format(valor)} L`;
const diff = (valor) => valor == null ? '—' : `${valor > 0 ? '+' : ''}${formatoLitros.format(valor)} L`;
const iconos = { ok: CheckCircle2, pendiente: Clock3, revisar: AlertCircle, informativo: Info };

export default function CoseducamPwa({ onCerrarSesion, cerrandoSesion }) {
  const [fecha, setFecha] = useState(fechaAnteriorChile);
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const periodo = fecha.slice(0, 7);
  const consultar = useCallback(async () => {
    setCargando(true); setError('');
    try { setDatos(await obtenerCoseducam(periodo)); }
    catch (e) { setError(e?.message || 'No fue posible consultar las fuentes.'); }
    finally { setCargando(false); }
  }, [periodo]);
  useEffect(() => { consultar(); }, [consultar]);
  const dia = useMemo(() => (datos?.dias || []).find((x) => x.fecha === fecha), [datos, fecha]);
  const categoria = categoriaSeguimiento(dia);
  const IconoEstado = iconos[categoria] || Info;
  const guias = dia?.guias || (dia?.guia ? [dia.guia] : []);
  const resultado = dia?.conciliacion;
  return <div className="coseducam-pwa-shell">
    <header className="pwa-header">
      <div className="pwa-brand">
        <div className="pwa-brand-mark">V</div>
        <div><strong>Coseducam</strong><span>Seguimiento TAE · Solo lectura</span></div>
      </div>
      <button type="button" className="header-icon-button" onClick={onCerrarSesion}
        disabled={cerrandoSesion} aria-label="Cerrar sesión"><LogOut size={20} /></button>
    </header>
    <main className="pwa-main">
      <section className="date-panel">
        <label htmlFor="fecha-seguimiento"><CalendarDays size={18} /> Fecha de consumo</label>
        <input id="fecha-seguimiento" type="date" value={fecha} max={fechaHoy()}
          onChange={(e) => { if (e.target.value) setFecha(e.target.value); }} />
      </section>
      {error ? <div className="pwa-feedback error">{error}</div> : null}
      {datos?.advertenciaEnRuta ? <div className="pwa-feedback warning">{datos.advertenciaEnRuta}</div> : null}
      <section className="daily-summary" aria-label="Consumo CopecFuel">
        <div><span>Litros STORAGE</span><strong>{litros(dia?.consumo?.litros)}</strong></div>
        <div><span>Precio máximo STORAGE</span>
          <strong>{dia?.consumo?.precioTae == null ? '—' : formatoPrecio.format(dia.consumo.precioTae)}</strong>
        </div>
      </section>
      <section className={`tae-followup-card tae-tone-${categoria}`} aria-label="Seguimiento del retiro TAE">
        <div className="tae-followup-header">
          <div><h2>Retiro TAE</h2><p>Verificación del {fecha.split('-').reverse().join('-')}</p></div>
          <span className={`tae-status tae-status-${categoria}`}><IconoEstado size={16} />{dia ? tituloSeguimiento(dia) : 'Sin consumo'}</span>
        </div>
        {!dia ? <div className="tae-no-data">
          {cargando ? 'Consultando fuentes…' : 'No hay consumos STORAGE registrados para esta fecha.'}
        </div> : <>
          <div className="tae-detail-grid">
            <div className="tae-detail-group">
              <h3>CopecFuel · Esperado</h3>
              <dl>
                <div><dt>Consumo real</dt><dd>{litros(dia.consumo?.litros)}</dd></div>
                <div><dt>Guía esperada</dt><dd>{litros(dia.consumo?.litrosEsperados)}</dd></div>
                <div><dt>Cargas</dt><dd>{dia.consumo?.cargas ?? '—'}</dd></div>
              </dl>
            </div>
            <div className="tae-detail-group">
              <h3>En Ruta · Encontrado</h3>
              {guias.length ? guias.map((guia, i) => <dl key={`${guia.numeroGuia || 'guia'}-${i}`}>
                {i > 0 ? <div className="tae-other-guide"><dt>Otra guía</dt><dd>{i + 1}</dd></div> : null}
                <div><dt>N° guía</dt><dd>{guia.numeroGuia || '—'}</dd></div>
                <div><dt>Estado</dt><dd>{guia.estadoEnRuta || '—'}</dd></div>
                <div><dt>Fecha estado</dt><dd className="tae-date-value">{fechaHoraEnRuta(guia.fechaEstado)}</dd></div>
                <div><dt>Litros entregados</dt><dd>{litros(guia.litros)}</dd></div>
              </dl>) : <p className="tae-empty-copy">No hay guía identificada para este día.</p>}
            </div>
          </div>
          <div className="tae-validation">
            <div className="tae-validation-title">Comparación de litros</div>
            <div className="tae-validation-values">
              <div><span>Esperados</span><strong>{litros(dia.consumo?.litrosEsperados)}</strong></div>
              <div><span>En Ruta</span><strong>{litros(resultado?.litrosEnRuta)}</strong></div>
              <div><span>Diferencia real</span><strong>{diff(resultado?.diferenciaLitros)}</strong></div>
            </div>
            <small>{resultado?.resultadoComparacion === 'COINCIDE'
              ? 'Coincide con la regla de redondeo al litro entero (0,5 hacia arriba).'
              : resultado?.resultadoComparacion === 'PENDIENTE'
                ? 'Pendiente: los litros entregados no se validan hasta finalizar el retiro.'
                : resultado?.resultadoComparacion === 'NO_COINCIDE'
                  ? 'Diferencia fuera del redondeo esperado.'
                  : 'Comparación pendiente de información verificable.'}</small>
          </div>
          <p className="tae-followup-message">{dia.motivo || dia.observacion}</p>
        </>}
      </section>
      <button className="pwa-button secondary tae-refresh" type="button" onClick={consultar} disabled={cargando}>
        <RefreshCw size={17} className={cargando ? 'spin' : ''} />
        {cargando ? 'Consultando…' : 'Actualizar seguimiento'}
      </button>
      <p className="tae-readonly-note">Solo consulta · CopecFuel y En Ruta. Sin emisión ni confirmación de guías.</p>
    </main>
  </div>;
}
