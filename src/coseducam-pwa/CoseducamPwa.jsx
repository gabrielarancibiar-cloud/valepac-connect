import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
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
  RotateCcw,
  Route,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import {
  confirmarGuiaCoseducam,
  crearGuiaCoseducam,
  importarLitrosCoseducam,
  obtenerCoseducam,
} from "../services/coseducamApi.js";

const CODIGO_EDS = "40098";
const DIRECCION_COSEDUCAM = "fuenzalida 31";

const formatoLitros = new Intl.NumberFormat("es-CL", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
});
const formatoEnteros = new Intl.NumberFormat("es-CL", {
  maximumFractionDigits: 0,
});
const formatoPrecio = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
});

// Respaldo local de la regla del servidor (fracción 0,5 o superior sube). Solo
// se usa si la respuesta viniera sin `litrosGuia`; el valor que manda siempre
// es el que calcula la API.
function redondearLitrosGuia(valor) {
  const litros = Number(valor);
  if (!Number.isFinite(litros)) return 0;
  return Math.floor(Math.round(litros * 1000) / 1000 + 0.5);
}

function fechaLocalActual() {
  const fecha = new Date();
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(fecha.getDate()).padStart(2, "0")}`;
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
    return { texto: "Reintentar", clase: "danger" };
  }
  if (dia?.estado === "procesando") {
    return {
      texto: dia?.guia?.procesandoVencido ? "Reintentar" : "En curso",
      clase: dia?.guia?.procesandoVencido ? "danger" : "pending",
    };
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
              <span>Precio observado</span>
              <strong>{formatoPrecio.format(modal.precioObservado || 0)}</strong>
            </div>
          </div>
        ) : null}
        {modal.litrosAnteriores !== undefined ? (
          <div className="price-comparison">
            <div>
              <span>Litros en pantalla</span>
              <strong>
                {formatoEnteros.format(modal.litrosAnteriores || 0)} L
              </strong>
            </div>
            <ChevronRight size={20} />
            <div className="observed-price">
              <span>Litros recalculados</span>
              <strong>{formatoEnteros.format(modal.litrosNuevos || 0)} L</strong>
            </div>
          </div>
        ) : null}
        {modal.advertencia ? (
          <p className="pwa-modal-warning">
            <AlertTriangle size={17} /> {modal.advertencia}
          </p>
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
  // El entero de la guía lo calcula el servidor: pantalla y autorización usan
  // exactamente el mismo número.
  const litrosGuia = Number(
    dia?.consumo?.litrosGuia ?? redondearLitrosGuia(litros)
  );
  const precioObservado = Number(
    dia?.consumo?.precioDieselObservado?.precio || 0
  );
  const guia = dia?.guia || null;
  const guiaCreada = ["creada", "confirmada"].includes(dia?.estado);
  const guiaConfirmada = dia?.estado === "confirmada";
  // Un intento fallido ya no deja el día sin salida: se ofrece reintentar.
  const puedeReintentar = Boolean(guia?.puedeReintentar);
  const creacionEnCurso = dia?.estado === "procesando" && !puedeReintentar;

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

  useEffect(() => {
    cargarMes();
  }, [cargarMes]);

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
      await importarLitrosCoseducam(fecha);
      const resultado = await cargarMes(true);
      const diaActualizado = (resultado?.dias || []).find(
        (item) => item.fecha === fecha
      );
      const litrosActualizados = Number(diaActualizado?.consumo?.litros || 0);

      setMensaje(
        litrosActualizados > 0
          ? `${formatoLitros.format(litrosActualizados)} litros importados correctamente.`
          : "La importación terminó, pero no encontró litros STORAGE de Coseducam para este día."
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

  const ejecutarCrearGuia = async (opciones = {}) => {
    setAccion("crear");
    setError("");
    setMensaje("");

    try {
      const resultado = await crearGuiaCoseducam({
        fecha,
        direccion: DIRECCION_COSEDUCAM,
        codigoEds: CODIGO_EDS,
        litrosEsperados: litrosGuia,
        ...opciones,
      });
      setMensaje(
        `Guía creada${
          resultado.numeroGuia ? `: N.º ${resultado.numeroGuia}` : ""
        }. Litros enteros: ${formatoEnteros.format(
          resultado.litros || litrosGuia
        )} L. Precio aplicado ${formatoPrecio.format(
          resultado.precioAplicado || precioObservado
        )}.`
      );
      await cargarMes(true);
    } catch (errorGuia) {
      // Cada confirmación pendiente se resuelve con un modal y conserva las
      // confirmaciones ya otorgadas, para no volver a empezar el flujo.
      if (errorGuia.requiereConfirmacionPrecio) {
        setModal({
          tipo: "precio",
          titulo: "Confirmar precio observado",
          descripcion:
            "El precio sugerido por Portal TCT/TAE no coincide. La guía se creará únicamente con el precio observado del día.",
          accion: "Usar precio observado",
          precioPortal: errorGuia.precioPortal,
          precioObservado: errorGuia.precioObservado,
          opciones: { ...opciones, confirmarPrecioObservado: true },
        });
      } else if (errorGuia.requiereConfirmacionLitros) {
        setModal({
          tipo: "litros",
          titulo: "Los litros cambiaron",
          descripcion:
            "El consumo del día se actualizó después de abrir la pantalla. Confirma el nuevo total entero para crear la guía.",
          accion: "Usar el nuevo total",
          litrosAnteriores: errorGuia.litrosEsperados,
          litrosNuevos: errorGuia.litrosGuia,
          opciones: { ...opciones, confirmarLitros: true },
        });
      } else if (errorGuia.requiereConfirmacionReintento) {
        setModal({
          tipo: "reintento",
          titulo: "Revisa el portal antes de reintentar",
          descripcion: errorGuia.message,
          advertencia:
            "Si la guía ya aparece emitida en el Portal TCT/TAE, cancela: reintentar crearía una segunda guía.",
          accion: "Reintentar de todas formas",
          opciones: { ...opciones, reintentar: true },
        });
      } else {
        setError(errorGuia.message || "No fue posible crear la guía TAE.");
        await cargarMes(true);
      }
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
    const opciones = modal?.opciones || {};
    setModal(null);

    if (tipo === "confirmar") {
      await ejecutarConfirmacionEnRuta();
      return;
    }

    if (["crear", "precio", "litros", "reintento"].includes(tipo)) {
      await ejecutarCrearGuia(opciones);
    }
  };

  const abrirModalCreacion = () =>
    setModal({
      tipo: "crear",
      titulo: puedeReintentar ? "Reintentar guía TAE" : "Crear guía TAE",
      descripcion: `El consumo es ${formatoLitros.format(
        litros
      )} L. Se solicitará una guía por ${formatoEnteros.format(
        litrosGuia
      )} litros enteros a ${formatoPrecio.format(precioObservado)} por litro.`,
      accion: puedeReintentar ? "Reintentar" : "Crear guía",
      // Nunca se fuerza el reintento desde aquí: si el intento anterior
      // alcanzó a enviar la autorización, el servidor responde pidiendo una
      // confirmación aparte con la advertencia correspondiente.
      opciones: {},
    });

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
                <span>Consumo del día</span>
                <strong>{formatoLitros.format(litros)} L</strong>
              </div>
              <div>
                <span>Litros de la guía</span>
                <strong>{formatoEnteros.format(litrosGuia)} L</strong>
              </div>
              <div>
                <span>Precio observado</span>
                <strong>{precioObservado ? formatoPrecio.format(precioObservado) : "—"}</strong>
              </div>
            </section>

            <section className="operation-flow" aria-busy={Boolean(accion)}>
              <PasoOperacion
                numero="1"
                titulo="Importar litros"
                descripcion="Ventas diésel STORAGE del día"
                boton="Importar litros"
                icono={CloudDownload}
                estado={litros > 0 ? "Importado" : "Pendiente"}
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
                  <span>Importa la información para comenzar.</span>
                )}
              </PasoOperacion>

              <PasoOperacion
                numero="2"
                titulo="Crear TAE"
                descripcion={`Guía por ${formatoEnteros.format(
                  litrosGuia
                )} litros enteros`}
                boton={
                  guiaCreada
                    ? "Guía creada"
                    : puedeReintentar
                      ? "Reintentar TAE"
                      : "Crear TAE"
                }
                icono={puedeReintentar && !guiaCreada ? RotateCcw : FileCheck2}
                estado={
                  guiaCreada
                    ? "Completado"
                    : puedeReintentar
                      ? "Requiere reintento"
                      : creacionEnCurso
                        ? "En curso"
                        : "Pendiente"
                }
                completado={guiaCreada}
                disabled={
                  !enLinea ||
                  litros <= 0 ||
                  guiaCreada ||
                  creacionEnCurso ||
                  precioObservado <= 0
                }
                procesando={accion === "crear"}
                onClick={abrirModalCreacion}
              >
                {guiaCreada ? (
                  <>
                    <CheckCircle2 size={17} />
                    <span>
                      <strong>Guía creada</strong>
                      {guia?.numeroGuia ? ` · N.º ${guia.numeroGuia}` : ""}
                      {guia?.litros ? ` · ${formatoEnteros.format(guia.litros)} L` : ""}
                    </span>
                  </>
                ) : puedeReintentar ? (
                  <>
                    <AlertTriangle size={17} />
                    <span>
                      <strong>El intento anterior no terminó.</strong>{" "}
                      {guia?.mensaje || "Puedes reintentarlo ahora."}
                    </span>
                  </>
                ) : creacionEnCurso ? (
                  <span>
                    Hay una creación en curso. Espera unos minutos y actualiza.
                  </span>
                ) : precioObservado <= 0 && litros > 0 ? (
                  <span>Falta el precio observado. Vuelve a importar el día.</span>
                ) : litros > 0 ? (
                  <span>
                    Se solicitarán {formatoEnteros.format(litrosGuia)} L enteros
                    a {formatoPrecio.format(precioObservado)} por litro.
                  </span>
                ) : (
                  <span>Disponible después de importar los litros.</span>
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
                disabled={!enLinea || !guiaCreada || guiaConfirmada}
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
                  <span>Guía N.º {guia?.numeroGuia || "—"} lista para confirmar.</span>
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
                      <div>
                        <span>Consumo</span>
                        <strong>
                          {formatoLitros.format(item.consumo?.litros || 0)} L
                        </strong>
                      </div>
                      <div>
                        <span>Litros guía</span>
                        <strong>
                          {formatoEnteros.format(
                            item.guia?.litros ||
                              item.consumo?.litrosGuia ||
                              redondearLitrosGuia(item.consumo?.litros || 0)
                          )}{" "}
                          L
                        </strong>
                      </div>
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
