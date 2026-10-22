import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  CloudDownload,
  Download,
  FileCheck2,
  History,
  Home,
  LogOut,
  RefreshCw,
  Route,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import {
  confirmarGuiaCoseducam,
  crearGuiaCoseducam,
  actualizarCoseducamDesdeCopecFuel,
  importarLitrosCoseducam,
  obtenerCoseducam,
  revisarHabilitacionTae,
} from "../services/coseducamApi.js";

const CODIGO_EDS = "40098";
const DIRECCION_COSEDUCAM = "fuenzalida 31";

const formatoLitros = new Intl.NumberFormat("es-CL", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
});
const formatoPrecio = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
});

function redondearLitrosGuia(valor) {
  const litros = Number(valor);
  if (!Number.isFinite(litros)) return 0;
  return Math.floor(Math.round(litros * 1000) / 1000 + 0.5);
}

function fechaLocalActual() {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const valor = (tipo) => partes.find((p) => p.type === tipo)?.value;
  return `${valor("year")}-${valor("month")}-${valor("day")}`;
}

function despuesDelCorteChile() {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago", hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const valor = (tipo) => partes.find((p) => p.type === tipo)?.value;
  return `${valor("hour")}:${valor("minute")}:${valor("second")}` >= "23:50:00";
}

function formatearFecha(fecha, opciones = {}) {
  if (!fecha) return "—";
  const valor = new Date(`${fecha}T12:00:00`);

  return valor.toLocaleDateString("es-CL", {
    day: "2-digit",
    month: opciones.corta ? "short" : "long",
    year: opciones.sinAnio ? undefined : "numeric",
  });
}

function estadoVisual(dia) {
  if (dia?.estado === "confirmada") {
    return { texto: "Confirmada", clase: "success" };
  }
  if (dia?.estado === "creada") {
    return { texto: "Guía creada", clase: "created" };
  }
  if (dia?.estado === "revision_requerida") {
    return { texto: "Revisión", clase: "danger" };
  }
  if ((dia?.consumo?.litros || 0) > 0) {
    return { texto: "Pendiente", clase: "pending" };
  }
  return { texto: "Sin registros", clase: "neutral" };
}

function ModalConfirmacion({ modal, onCancelar, onConfirmar, procesando }) {
  if (!modal) return null;

  return (
    <div className="pwa-modal-backdrop" role="presentation">
      <section
        className="pwa-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <button
          type="button"
          className="pwa-modal-close"
          onClick={onCancelar}
          disabled={procesando}
          aria-label="Cerrar"
        >
          <X size={20} />
        </button>
        <div className={`pwa-modal-icon ${modal.tipo}`}>
          {modal.tipo === "confirmar" ? <Route size={25} /> : <FileCheck2 size={25} />}
        </div>
        <h2 id="modal-title">{modal.titulo}</h2>
        <p>{modal.descripcion}</p>
        {modal.precioPortal !== undefined ? (
          <div className="price-comparison">
            <div>
              <span>Portal TCT/TAE</span>
              <strong>{formatoPrecio.format(modal.precioPortal || 0)}</strong>
            </div>
            <ChevronRight size={20} />
            <div className="observed-price">
              <span>Precio máximo STORAGE</span>
              <strong>{formatoPrecio.format(modal.precioObservado || 0)}</strong>
            </div>
          </div>
        ) : null}
        <div className="pwa-modal-actions">
          <button
            type="button"
            className="pwa-button secondary"
            onClick={onCancelar}
            disabled={procesando}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="pwa-button primary"
            onClick={onConfirmar}
            disabled={procesando}
          >
            {procesando ? <RefreshCw className="spin" size={17} /> : null}
            {modal.accion}
          </button>
        </div>
      </section>
    </div>
  );
}

function PasoOperacion({
  numero,
  titulo,
  descripcion,
  boton,
  icono: Icono,
  estado,
  completado,
  disabled,
  procesando,
  onClick,
  children,
}) {
  return (
    <article className={`operation-step ${completado ? "is-complete" : ""}`}>
      <div className="step-number">
        {completado ? <Check size={17} strokeWidth={3} /> : numero}
      </div>
      <div className="step-body">
        <div className="step-heading">
          <div className="step-title">
            <Icono size={20} />
            <div>
              <h2>{titulo}</h2>
              <p>{descripcion}</p>
            </div>
          </div>
          {estado ? <span className="step-state">{estado}</span> : null}
        </div>
        <button
          type="button"
          className={`pwa-button ${completado ? "secondary" : "primary"}`}
          onClick={onClick}
          disabled={disabled || procesando}
        >
          {procesando ? (
            <RefreshCw className="spin" size={18} />
          ) : (
            <Icono size={18} />
          )}
          {procesando ? "Procesando…" : boton}
        </button>
        {children ? <div className="step-result">{children}</div> : null}
      </div>
    </article>
  );
}

export default function CoseducamPwa({
  administrador,
  onCerrarSesion,
  cerrandoSesion,
}) {
  const [fecha, setFecha] = useState(fechaLocalActual);
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [accion, setAccion] = useState("");
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [modal, setModal] = useState(null);
  const [vista, setVista] = useState("operar");
  const [enLinea, setEnLinea] = useState(navigator.onLine);
  const [instalacion, setInstalacion] = useState(null);
  const [diagnostico, setDiagnostico] = useState(null);
  const [diagnosticando, setDiagnosticando] = useState(false);
  const [errorDiagnostico, setErrorDiagnostico] = useState("");
  const [revisionReloj, setRevisionReloj] = useState(0);
  const periodo = fecha.slice(0, 7);

  const dia = useMemo(
    () => (datos?.dias || []).find((item) => item.fecha === fecha) || null,
    [datos, fecha]
  );
  const actividad = useMemo(
    () =>
      (datos?.dias || [])
        .filter((item) => (item.consumo?.litros || 0) > 0 || item.guia)
        .sort((a, b) => b.fecha.localeCompare(a.fecha)),
    [datos]
  );
  const litros = Number(dia?.consumo?.litros || 0);
  const precioObservado = Number(dia?.consumo?.precioTae || 0);
  // revisionReloj provoca una reevaluación automática a las 23:50.
  void revisionReloj;
  const esFechaEmitible = fecha === fechaLocalActual() && fecha >= "2026-10-15" && despuesDelCorteChile();
  const datosCompletos = dia?.consumo?.datosCompletos === true;
  const crearHabilitado = datos?.emisionTaeDisponible === true && esFechaEmitible && datosCompletos;
  const confirmarHabilitado = datos?.confirmacionEnRutaDisponible === true &&
    dia?.job?.estado === "esperando_enruta";
  const guia = dia?.guia || null;
  const guiaCreada = ["creada", "confirmada"].includes(dia?.estado);
  const guiaConfirmada = dia?.estado === "confirmada";

  const cargarMes = useCallback(async (silencioso = false) => {
    if (!silencioso) setCargando(true);

    try {
      const resultado = await obtenerCoseducam(periodo);
      setDatos(resultado);
      setError("");
      return resultado;
    } catch (errorCarga) {
      setError(errorCarga.message || "No fue posible cargar Coseducam.");
      return null;
    } finally {
      if (!silencioso) setCargando(false);
    }
  }, [periodo]);

  const cargarDiagnostico = useCallback(async (silencioso = false) => {
    if (!silencioso) setDiagnosticando(true);
    try {
      const respuesta = await revisarHabilitacionTae(fecha);
      setDiagnostico(respuesta);
      setErrorDiagnostico("");
      return respuesta;
    } catch (e) {
      setDiagnostico(null);
      setErrorDiagnostico(e.message || "No se pudo comprobar la habilitación en Vercel.");
      return null;
    } finally {
      if (!silencioso) setDiagnosticando(false);
    }
  }, [fecha]);

  useEffect(() => {
    cargarMes();
    cargarDiagnostico();
  }, [cargarMes, cargarDiagnostico]);

  // Antes y durante la ventana de 23:50, refrescar automáticamente los indicadores.
  // Solo lectura: no ejecuta las acciones Crear TAE ni Confirmar En Ruta.
  useEffect(() => {
    const tic = setInterval(() => setRevisionReloj((valor) => valor + 1), 10000);
    const sincronizar = setInterval(() => {
      const partes = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Santiago", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
      }).formatToParts(new Date());
      const valor = (tipo) => partes.find((p) => p.type === tipo)?.value;
      const hm = `${valor("hour")}:${valor("minute")}`;
      if (fecha === fechaLocalActual() && hm >= "23:48" && hm <= "23:59") {
        cargarMes(true);
        cargarDiagnostico(true);
      }
    }, 30000);
    return () => { clearInterval(tic); clearInterval(sincronizar); };
  }, [fecha, cargarMes, cargarDiagnostico]);

  useEffect(() => {
    const conectar = () => setEnLinea(true);
    const desconectar = () => setEnLinea(false);
    const prepararInstalacion = (evento) => {
      evento.preventDefault();
      setInstalacion(evento);
    };

    window.addEventListener("online", conectar);
    window.addEventListener("offline", desconectar);
    window.addEventListener("beforeinstallprompt", prepararInstalacion);

    return () => {
      window.removeEventListener("online", conectar);
      window.removeEventListener("offline", desconectar);
      window.removeEventListener("beforeinstallprompt", prepararInstalacion);
    };
  }, []);

  const instalarPwa = async () => {
    if (!instalacion) return;
    await instalacion.prompt();
    await instalacion.userChoice;
    setInstalacion(null);
  };

  const importarLitros = async () => {
    setAccion("importar");
    setError("");
    setMensaje("");

    try {
      const consultaV2 = await importarLitrosCoseducam(fecha);
      if (consultaV2.flujo !== "COSEDUCAM_V2") throw new Error("No se pudo verificar el motor V2.");
      const resultado = await cargarMes(true);
      await cargarDiagnostico(true);
      const diaActualizado = (resultado?.dias || []).find(
        (item) => item.fecha === fecha
      );
      const litrosActualizados = Number(diaActualizado?.consumo?.litros || 0);

      setMensaje(
        litrosActualizados > 0
          ? `${formatoLitros.format(litrosActualizados)} litros consultados en Data Lake (sin resincronizar).`
          : "La consulta terminó, pero no encontró litros STORAGE elegibles o aún faltan datos de Data Lake."
      );
    } catch (errorImportacion) {
      setError(
        errorImportacion.requiereCodigoEquipo
          ? "CopecFuel requiere validar el equipo. Realiza la validación en VALEPAC Connect y vuelve a importar."
          : errorImportacion.message || "No fue posible importar los litros."
      );
    } finally {
      setAccion("");
    }
  };

  const actualizarCopecFuel = async () => {
    if (fecha !== fechaLocalActual() || fecha < "2026-10-15") {
      setError("Solo se puede actualizar la fecha actual. Los históricos son consulta.");
      return;
    }
    setAccion("actualizar");
    setError("");
    setMensaje("");
    try {
      const respuesta = await actualizarCoseducamDesdeCopecFuel(fecha);
      if (respuesta.estado !== "DATA_LAKE_ACTUALIZADO" ||
          respuesta.sincronizacionEjecutada !== true) {
        throw new Error("No se confirmó una extracción y un procesamiento nuevos.");
      }
      await cargarMes(true);
      await cargarDiagnostico(true);
      setMensaje(`CopecFuel actualizado: ${respuesta.transaccionesCombustible} ventas; ` +
        `${respuesta.lineasCoseducam} cargas COSEDUCAM. Captura ${
          new Date(respuesta.capturadoEn).toLocaleString("es-CL", {timeZone:"America/Santiago",dateStyle:"short",timeStyle:"medium"})
        }.`);
    } catch (e) {
      setError(e.message || "No se completó la actualización desde CopecFuel.");
    } finally {
      setAccion("");
    }
  };

  const ejecutarCrearGuia = async () => {
    setAccion("crear");
    setError("");
    setMensaje("");
    try {
      const resultado = await crearGuiaCoseducam({fecha, codigoEds: CODIGO_EDS});
      setMensaje(`Guía TAE ${resultado.numeroGuia || ""} registrada con ${formatoLitros.format(
        resultado.litros || redondearLitrosGuia(litros)
      )} L a ${formatoPrecio.format(resultado.precioAplicado || precioObservado)}/L.`);
      await cargarMes(true);
    } catch (errorGuia) {
      setError(errorGuia.message || "No fue posible crear la guía TAE.");
    } finally {
      setAccion("");
    }
  };

  const ejecutarConfirmacionEnRuta = async () => {
    setAccion("confirmar");
    setError("");
    setMensaje("");

    try {
      const resultado = await confirmarGuiaCoseducam({
        fecha,
        guiaId: guia?.id,
      });
      setMensaje(resultado.mensaje || "Guía confirmada correctamente en EnRuta.");
      await cargarMes(true);
    } catch (errorConfirmacion) {
      setError(
        errorConfirmacion.message || "No fue posible confirmar la guía en EnRuta."
      );
    } finally {
      setAccion("");
    }
  };

  const aceptarModal = async () => {
    const tipo = modal?.tipo;
    setModal(null);

    if (tipo === "crear") await ejecutarCrearGuia();
    if (tipo === "confirmar") await ejecutarConfirmacionEnRuta();
  };

  return (
    <div className="coseducam-pwa-shell">
      <header className="pwa-header">
        <div className="pwa-brand">
          <div className="pwa-brand-mark">V</div>
          <div>
            <strong>Coseducam</strong>
            <span>Gestión de guías TAE</span>
          </div>
        </div>
        <div className="pwa-header-actions">
          {instalacion ? (
            <button type="button" className="install-button" onClick={instalarPwa}>
              <Download size={16} /> Instalar
            </button>
          ) : null}
          <span className={`network-dot ${enLinea ? "online" : "offline"}`}>
            {enLinea ? <Wifi size={16} /> : <WifiOff size={16} />}
          </span>
          <button
            type="button"
            className="header-icon-button"
            onClick={onCerrarSesion}
            disabled={cerrandoSesion}
            aria-label="Cerrar sesión"
          >
            <LogOut size={19} />
          </button>
        </div>
      </header>

      <main className="pwa-main">
        {vista === "operar" ? (
          <>
            <section className="date-panel">
              <label htmlFor="fecha-operacion">
                <CalendarDays size={18} />
                <span>Fecha a consultar</span>
              </label>
              <input
                id="fecha-operacion"
                type="date"
                value={fecha}
                max={fechaLocalActual()}
                onChange={(evento) => {
                  setFecha(evento.target.value);
                  setDiagnostico(null);
                  setErrorDiagnostico("");
                  setError("");
                  setMensaje("");
                }}
                disabled={Boolean(accion)}
              />
            </section>

            {error ? <div className="pwa-feedback error">{error}</div> : null}
            {mensaje ? <div className="pwa-feedback success">{mensaje}</div> : null}
            {!enLinea ? (
              <div className="pwa-feedback warning">
                Sin conexión. Puedes revisar datos anteriores, pero las acciones necesitan internet.
              </div>
            ) : null}

            <section className="daily-summary">
              <div>
                <span>Litros Coseducam</span>
                <strong>{formatoLitros.format(litros)} L</strong>
              </div>
              <div>
                <span>Precio máximo STORAGE</span>
                <strong>{precioObservado ? formatoPrecio.format(precioObservado) : "—"}</strong>
              </div>
            </section>

            <section className="operation-flow" aria-busy={Boolean(accion)}>
              <PasoOperacion
                numero="1"
                titulo="Consultar litros"
                descripcion="Consumos STORAGE COSEDUCAM desde Data Lake"
                boton="Consultar Data Lake"
                icono={CloudDownload}
                estado={litros > 0 ? "Consultado" : "Pendiente"}
                completado={litros > 0}
                disabled={!enLinea}
                procesando={accion === "importar"}
                onClick={importarLitros}
              >
                {litros > 0 ? (
                  <>
                    <CheckCircle2 size={17} />
                    <span>
                      <strong>{formatoLitros.format(litros)} L</strong> encontrados en {dia?.consumo?.transacciones || 0} carga(s)
                    </span>
                  </>
                ) : (
                  <span>Consulta los consumos registrados en Data Lake.</span>
                )}
              </PasoOperacion>
              <div className="pwa-data-refresh">
                <button type="button" className="pwa-button secondary"
                  onClick={actualizarCopecFuel}
                  disabled={!enLinea || Boolean(accion) || fecha !== fechaLocalActual() ||
                    fecha < "2026-10-15" || Boolean(dia?.job) || Boolean(dia?.guia)}>
                  <RefreshCw size={17} className={accion === "actualizar" ? "spin" : ""}/>
                  {accion === "actualizar" ? "Actualizando archivo y resúmenes…" : "Actualizar desde CopecFuel"}
                </button>
                <p className="pwa-refresh-note">Consulta rápida: solo PostgreSQL. Actualizar: obtiene un JSON nuevo,
                  archiva y procesa M2, Recompra y COSEDUCAM.</p>
                <p className="pwa-refresh-note">
                  Última captura Data Lake: {dia?.dataLake?.capturado_en
                    ? new Date(dia.dataLake.capturado_en).toLocaleString("es-CL", {timeZone:"America/Santiago", dateStyle:"short",timeStyle:"medium"})
                    : "Sin captura registrada"}
                  {dia?.dataLake?.procesado_en ? ` · Procesado ${
                    new Date(dia.dataLake.procesado_en).toLocaleString("es-CL", {timeZone:"America/Santiago",dateStyle:"short",timeStyle:"medium"})}` : ""}
                </p>
              </div>

              <section className="tae-preflight" aria-label="Diagnóstico de habilitación TAE">
                <div className="tae-preflight-header">
                  <div>
                    <strong>Habilitación de emisión — Diagnóstico V2</strong>
                    <small>Solo consulta; no emite guías ni crea reservas.</small>
                  </div>
                  <button type="button" className="pwa-button secondary"
                    onClick={() => cargarDiagnostico()} disabled={!enLinea || diagnosticando}>
                    {diagnosticando ? "Revisando…" : "Revisar habilitación"}
                  </button>
                </div>
                {errorDiagnostico ? <p className="tae-preflight-error">{errorDiagnostico}</p> : null}
                {diagnostico ? (
                  <>
                    <p className="tae-preflight-meta">
                      Servidor: {diagnostico.servidorFechaChile} {diagnostico.servidorHoraChile} (Chile)
                      · Versión: {diagnostico.versionDiagnostico}
                    </p>
                    <div className="tae-preflight-controls">
                      {[
                        ["Flag Vercel (TAE)", diagnostico.flags?.vercelTae],
                        ["Fecha operacional vigente", diagnostico.flags?.fechaOperacional],
                        ["Hora desde 23:50", diagnostico.flags?.horaDesdeCorte],
                        ["Consumos válidos", diagnostico.flags?.consumosValidos],
                        ["Cierre Data Lake", diagnostico.flags?.cierreAcreditado],
                        ["Preparación V2", diagnostico.flags?.preparacionLista],
                      ].map(([nombre, ok]) => (
                        <div className="tae-preflight-item" key={nombre}>
                          <span>{nombre}</span>
                          <strong className={ok ? "preflight-ok" : "preflight-no"}>
                            {ok ? "Sí" : "No"}
                          </strong>
                        </div>
                      ))}
                    </div>
                    {diagnostico.bloqueos?.length ? (
                      <p className="tae-preflight-notice">
                        {diagnostico.bloqueos.map((b) => b.detalle).join(" ")}
                      </p>
                    ) : <p className="tae-preflight-ok">Prevalidación lista. El servidor validará todo nuevamente al crear TAE.</p>}
                    {datos && diagnostico.emisionTaeDisponible !== datos.emisionTaeDisponible ? (
                      <p className="tae-preflight-error">
                        Advertencia: lectura mensual y diagnóstico no coinciden en el flag de emisión.
                        Recarga desde la dirección web de la PWA y revisa el deployment de Vercel.
                      </p>
                    ) : null}
                    <p className="tae-preflight-meta">
                      Flag de la lectura mensual: {datos?.emisionTaeDisponible === true ? "ACTIVO" : "DESACTIVADO"}
                      · Flag diagnóstico del backend: {diagnostico.emisionTaeDisponible ? "ACTIVO" : "DESACTIVADO"}
                    </p>
                    <p className="tae-preflight-meta">
                      Cierre SQL: {diagnostico.controlCierre?.estado || "SIN_DATOS"}
                      · Última captura: {diagnostico.controlCierre?.capturadoEn
                        ? new Date(diagnostico.controlCierre.capturadoEn).toLocaleString("es-CL", {timeZone:"America/Santiago",dateStyle:"short",timeStyle:"medium"})
                        : "—"}
                    </p>
                  </>
                ) : <p className="tae-preflight-meta">Revisa la habilitación real del backend de Vercel.</p>}
              </section>

              <PasoOperacion
                numero="2"
                titulo="Crear TAE"
                descripcion="Guía con precio máximo STORAGE validado (V2)"
                boton={guiaCreada ? "Guía creada" : "Crear TAE"}
                icono={FileCheck2}
                estado={guiaCreada ? "Completado" : "Pendiente"}
                completado={guiaCreada}
                disabled={!enLinea || !crearHabilitado || litros <= 0 || guiaCreada || Boolean(dia?.job) || precioObservado <= 0}
                procesando={accion === "crear"}
                onClick={() =>
                  setModal({
                    tipo: "crear",
                    titulo: "Crear guía TAE",
                    descripcion: `El consumo es ${formatoLitros.format(
                      litros
                    )} L. Se solicitará una guía por ${formatoLitros.format(
                      redondearLitrosGuia(litros)
                    )} litros enteros a ${formatoPrecio.format(precioObservado)} por litro.`,
                    accion: "Crear guía",
                  })
                }
              >
                {guiaCreada ? (
                  <>
                    <CheckCircle2 size={17} />
                    <span>
                      <strong>Guía creada</strong>
                      {guia?.numeroGuia ? ` · N.º ${guia.numeroGuia}` : ""}
                    </span>
                  </>
                ) : dia?.historicoSoloConsulta ? (
                  <span>Fecha histórica: solo consulta, sin emisión V2.</span>
                ) : !datosCompletos ? (
                  <span>Faltan datos válidos del Data Lake para emitir TAE.</span>
                ) : datos?.emisionTaeDisponible !== true ? (
                  <span>El deployment de Vercel aún tiene desactivada la emisión TAE V2.</span>
                ) : fecha !== fechaLocalActual() ? (
                  <span>Solo se puede emitir para la fecha operacional actual.</span>
                ) : !esFechaEmitible ? (
                  <span>Esperando las 23:50, hora de Chile.</span>
                ) : diagnostico?.controlCierre?.acreditado !== true ? (
                  <span>Revisa el diagnóstico: el cierre de Data Lake aún no está acreditado.</span>
                ) : (
                  <span>El botón está habilitado. La emisión volverá a validar cierre y reserva en el servidor.</span>
                )}
              </PasoOperacion>

              <PasoOperacion
                numero="3"
                titulo="Confirmar EnRuta"
                descripcion="Validación final de la guía"
                boton={guiaConfirmada ? "Guía confirmada" : "Confirmar EnRuta"}
                icono={Route}
                estado={guiaConfirmada ? "Completado" : guiaCreada ? "Disponible" : "Pendiente"}
                completado={guiaConfirmada}
                disabled={!enLinea || !guiaCreada || guiaConfirmada || !confirmarHabilitado}
                procesando={accion === "confirmar"}
                onClick={() =>
                  setModal({
                    tipo: "confirmar",
                    titulo: "Confirmar guía en EnRuta",
                    descripcion: `Se validará la guía ${guia?.numeroGuia || "creada"} y los datos de Coseducam antes de confirmarla.`,
                    accion: "Confirmar guía",
                  })
                }
              >
                {guiaConfirmada ? (
                  <>
                    <CheckCircle2 size={17} />
                    <span><strong>Guía confirmada</strong> correctamente.</span>
                  </>
                ) : guiaCreada ? (
                  <span>Guía N.º {guia?.numeroGuia || "—"}. En Ruta V2 debe estar habilitada y el job acreditado.</span>
                ) : (
                  <span>Disponible después de crear la guía TAE.</span>
                )}
              </PasoOperacion>
            </section>

            <section className="recent-activity">
              <div className="section-heading">
                <div>
                  <h2>Actividad reciente</h2>
                  <p>Eventos registrados en {formatearFecha(`${periodo}-01`, { sinAnio: true })}.</p>
                </div>
                <button type="button" onClick={() => setVista("historial")}>Ver todo</button>
              </div>
              <div className="activity-list">
                {actividad.slice(0, 3).map((item) => {
                  const estado = estadoVisual(item);
                  return (
                    <button
                      type="button"
                      className="activity-row"
                      key={item.fecha}
                      onClick={() => setFecha(item.fecha)}
                    >
                      <span className={`activity-icon ${estado.clase}`}>
                        {estado.clase === "success" ? <Check size={16} /> : <Clock3 size={16} />}
                      </span>
                      <span className="activity-copy">
                        <strong>{formatearFecha(item.fecha, { corta: true })}</strong>
                        <small>
                          {item.guia?.numeroGuia
                            ? `Guía ${item.guia.numeroGuia}`
                            : `${formatoLitros.format(item.consumo?.litros || 0)} L`}
                        </small>
                      </span>
                      <span className={`history-status ${estado.clase}`}>{estado.texto}</span>
                    </button>
                  );
                })}
                {!cargando && actividad.length === 0 ? (
                  <div className="empty-history">No hay eventos registrados este mes.</div>
                ) : null}
              </div>
            </section>
          </>
        ) : (
          <section className="history-screen">
            <div className="history-header">
              <div>
                <span>Registro mensual</span>
                <h1>Historial</h1>
                <p>Consumos, guías y confirmaciones de Coseducam.</p>
              </div>
              <button type="button" onClick={() => cargarMes()} disabled={cargando}>
                <RefreshCw className={cargando ? "spin" : ""} size={19} />
              </button>
            </div>
            <label className="history-month">
              <span>Mes consultado</span>
              <input
                type="month"
                value={periodo}
                max={fechaLocalActual().slice(0, 7)}
                onChange={(evento) => setFecha(`${evento.target.value}-01`)}
              />
            </label>
            <div className="history-list">
              {actividad.map((item) => {
                const estado = estadoVisual(item);
                return (
                  <button
                    type="button"
                    className="history-card"
                    key={item.fecha}
                    onClick={() => {
                      setFecha(item.fecha);
                      setVista("operar");
                    }}
                  >
                    <div className="history-date">
                      <CalendarDays size={18} />
                      <strong>{formatearFecha(item.fecha)}</strong>
                    </div>
                    <span className={`history-status ${estado.clase}`}>{estado.texto}</span>
                    <div className="history-metrics">
                      <div><span>Litros</span><strong>{formatoLitros.format(item.consumo?.litros || 0)} L</strong></div>
                      <div><span>Precio</span><strong>{item.consumo?.precioTae ? formatoPrecio.format(item.consumo.precioTae) : "—"}</strong></div>
                      <div><span>Guía</span><strong>{item.guia?.numeroGuia || "—"}</strong></div>
                    </div>
                  </button>
                );
              })}
              {!cargando && actividad.length === 0 ? (
                <div className="empty-history large">
                  <History size={28} />
                  <strong>Sin actividad</strong>
                  <span>No hay eventos registrados en este mes.</span>
                </div>
              ) : null}
            </div>
          </section>
        )}
      </main>

      <nav className="pwa-bottom-nav" aria-label="Navegación principal">
        <button
          type="button"
          className={vista === "operar" ? "active" : ""}
          onClick={() => setVista("operar")}
        >
          <Home size={21} />
          <span>Operar</span>
        </button>
        <button
          type="button"
          className={vista === "historial" ? "active" : ""}
          onClick={() => setVista("historial")}
        >
          <History size={21} />
          <span>Historial</span>
        </button>
      </nav>

      <ModalConfirmacion
        modal={modal}
        onCancelar={() => setModal(null)}
        onConfirmar={aceptarModal}
        procesando={Boolean(accion)}
      />

      {cargando && !datos ? (
        <div className="pwa-loading">
          <RefreshCw className="spin" size={27} />
          <strong>Cargando Coseducam…</strong>
        </div>
      ) : null}

      <span className="sr-only" aria-live="polite">
        {mensaje || error || `Sesión de ${administrador?.email || "administrador"}`}
      </span>
    </div>
  );
}
