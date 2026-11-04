import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, LogOut, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';
import { obtenerCoseducam } from '../services/coseducamApi.js';
const formatoLitros=new Intl.NumberFormat('es-CL',{maximumFractionDigits:3});
const formatoPrecio=new Intl.NumberFormat('es-CL',{style:'currency',currency:'CLP',maximumFractionDigits:0});
const fechaHoy=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const ESTADOS={RETIRO_TAE_OK:'Retiro TAE OK',GUIA_EMITIDA_NO_CONFIRMADA:'Emitida · Sin retiro',DIFERENCIA_LITROS:'Diferencia de litros',
  SIN_GUIA_ENRUTA:'Sin guía confirmada',ENRUTA_NO_DISPONIBLE:'En Ruta no disponible',ENRUTA_DATOS_INSUFICIENTES:'En Ruta · Revisar',ENRUTA_ESTADO_NO_ACREDITADO:'Estado En Ruta · Revisar',
  REVISION_MULTIPLES_GUIAS:'Múltiples guías',REVISION_GUIA_REPETIDA:'Guía repetida',DATOS_COPECFUEL_INCOMPLETOS:'CopecFuel · Revisar',
  DIA_EN_CURSO_O_SIN_GUIA:'Día actual'};
export default function CoseducamPwa({onCerrarSesion,cerrandoSesion}) {
  const [fecha,setFecha]=useState(fechaHoy);
  const [datos,setDatos]=useState(null);
  const [cargando,setCargando]=useState(false);
  const [error,setError]=useState('');
  const periodo=fecha.slice(0,7);
  const consultar=useCallback(async()=>{
    setCargando(true);setError('');
    try {setDatos(await obtenerCoseducam(periodo));}
    catch(e){setError(e?.message||'No fue posible consultar las fuentes.');}
    finally{setCargando(false);}
  },[periodo]);
  useEffect(()=>{consultar();},[consultar]);
  const dia=useMemo(()=>(datos?.dias||[]).find(x=>x.fecha===fecha),[datos,fecha]);
  return <div className="coseducam-pwa-shell">
    <header className="pwa-header"><div className="pwa-brand"><div className="pwa-brand-mark">V</div>
      <div><strong>Coseducam</strong><span>Seguimiento TAE · Solo lectura</span></div></div>
      <button type="button" className="header-icon-button" onClick={onCerrarSesion} disabled={cerrandoSesion} aria-label="Cerrar sesión"><LogOut size={20}/></button>
    </header>
    <main className="pwa-main">
      <section className="date-panel"><label htmlFor="fecha-seguimiento"><CalendarDays size={18}/> Fecha</label>
        <input id="fecha-seguimiento" type="date" value={fecha} max={fechaHoy()} onChange={e=>setFecha(e.target.value)}/>
      </section>
      {error?<div className="pwa-feedback error">{error}</div>:null}
      {datos?.advertenciaEnRuta?<div className="pwa-feedback warning">{datos.advertenciaEnRuta}</div>:null}
      <section className="daily-summary"><div><span>Litros STORAGE</span><strong>{formatoLitros.format(dia?.consumo?.litros||0)} L</strong></div>
        <div><span>Precio máximo STORAGE</span><strong>{dia?.consumo?.precioTae?formatoPrecio.format(dia.consumo.precioTae):'—'}</strong></div>
      </section>
      <section className="operation-flow"><article className="operation-step"><div className="step-body"><h2>Retiro TAE</h2>
        <p>{dia?.estado === 'RETIRO_TAE_OK'?<CheckCircle2 size={18}/>:<AlertCircle size={18}/>} {ESTADOS[dia?.estado]||'Sin consumo o sin verificación'}</p>
        <p>Litros esperados: {dia?.consumo?.litrosEsperados??'—'} L</p>
        <p>Guía En Ruta: {dia?.guia?.numeroGuia||'—'} · Litros: {dia?.guia?.litros??'—'}</p>
      </div></article></section>
      <button className="pwa-button secondary" type="button" onClick={consultar} disabled={cargando}>
        <RefreshCw size={17} className={cargando?'spin':''}/>{cargando?'Consultando…':'Actualizar seguimiento'}
      </button>
      <p className="pwa-feedback warning">Esta aplicación no emite ni confirma guías. Consulta información de CopecFuel y En Ruta.</p>
    </main>
  </div>;
}
