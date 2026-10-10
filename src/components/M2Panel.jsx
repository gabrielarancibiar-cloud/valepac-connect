import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, ChevronDown, Fuel, RefreshCw, TrendingUp, Trash2, Save } from "lucide-react";
import { eliminarCostoBlueMax, guardarCostoBlueMax, obtenerCostosBlueMax, obtenerM2, sincronizarM2LakeDia } from "../services/m2Api.js";

const moneda = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
});
const monedaDecimal = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const numero = new Intl.NumberFormat("es-CL");
const litros = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 2 });

function nombreCategoria(tipo, segmento) {
  return `${tipo === "AUTOSERVICIO" ? "Autoservicio" : "Asistida"} · ${
    segmento === "TAXI_AMIGO" ? "Taxi Amigo" : "Normal"
  }`;
}

const PRODUCTOS_M2 = ["DIESEL", "GASOLINA 93", "GASOLINA 95", "GASOLINA 97", "BLUEMAX"];

function etiquetaProducto(producto) {
  const etiquetas = {
    DIESEL: "Diésel",
    "GASOLINA 93": "G93",
    "GASOLINA 95": "G95",
    "GASOLINA 97": "G97",
    BLUEMAX: "BlueMax",
  };
  return etiquetas[producto] || producto;
}

function resumirProductos(filas, tipoVenta = null, segmento = "TODO") {
  const base = new Map(
    PRODUCTOS_M2.map((producto) => [
      producto,
      { producto, litros: 0, m2Neto: 0, lineasSinCosto: 0 },
    ])
  );

  for (const fila of filas || []) {
    if (tipoVenta && fila.tipoVenta !== tipoVenta) continue;
    if (segmento === "TAXI_AMIGO" && fila.segmentoCliente !== "TAXI_AMIGO") continue;
    if (segmento === "ESTANDAR" && fila.segmentoCliente === "TAXI_AMIGO") continue;
    const producto = String(fila.producto || "").toUpperCase();
    if (!base.has(producto)) continue;
    const item = base.get(producto);
    item.litros += Number(fila.litros || 0);
    item.m2Neto += Number(fila.m2Neto || 0);
    item.lineasSinCosto += Number(fila.lineasSinCosto || 0);
  }

  return PRODUCTOS_M2.map((producto) => {
    const item = base.get(producto);
    return {
      ...item,
      m2Promedio: item.litros > 0 ? item.m2Neto / item.litros : 0,
    };
  });
}



function agruparDiasProductos(detalle, modo = "TODO", segmento = "TODO") {
  const grupos = new Map();

  for (const item of detalle || []) {
    if (modo !== "TODO" && item.tipoVenta !== modo) continue;
    if (segmento === "TAXI_AMIGO" && item.segmentoCliente !== "TAXI_AMIGO") continue;
    if (segmento === "ESTANDAR" && item.segmentoCliente === "TAXI_AMIGO") continue;
    const clave = `${item.fecha}|${item.producto}`;
    if (!grupos.has(clave)) {
      grupos.set(clave, {
        fecha: item.fecha,
        producto: item.producto,
        litros: 0,
        litrosConCosto: 0,
        m2Neto: 0,
        transacciones: new Set(),
        transaccionesResumen: 0,
        lineasSinCosto: 0,
      });
    }
    const grupo = grupos.get(clave);
    const litrosItem = Number(item.litros || 0);
    grupo.litros += litrosItem;
    if (item.esResumenDataLake) {
      grupo.transaccionesResumen += Number(item.transacciones || 0);
      grupo.litrosConCosto += Number(item.litrosConCosto ?? litrosItem);
      grupo.m2Neto += Number(item.m2Neto || 0);
      grupo.lineasSinCosto += Number(item.lineasSinCosto || 0);
    } else {
      grupo.transacciones.add(String(item.transaccionId || ""));
      if (item.precioCosto == null || item.m2Litro == null) {
        grupo.lineasSinCosto += 1;
      } else {
        grupo.litrosConCosto += litrosItem;
        grupo.m2Neto += Number(item.m2Neto || 0);
      }
    }
  }

  return [...grupos.values()]
    .map((grupo) => ({
      ...grupo,
      transacciones: grupo.transaccionesResumen || grupo.transacciones.size,
      m2Litro: grupo.litrosConCosto > 0 ? grupo.m2Neto / grupo.litrosConCosto : 0,
    }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.producto.localeCompare(b.producto));
}


function costosBlueMaxDelPeriodo(costos, periodo) {
  const lista = [...(costos || [])].sort((a, b) =>
    String(b.fecha_vigencia || "").localeCompare(String(a.fecha_vigencia || ""))
  );
  const inicioMes = `${periodo}-01`;
  const delMes = lista.filter((costo) => String(costo.fecha_vigencia || "").startsWith(periodo));
  const anteriores = lista.filter((costo) => String(costo.fecha_vigencia || "") < inicioMes);
  const anteriorVigente = anteriores[0] || null;

  const primeraFechaMes = delMes.length
    ? [...delMes].sort((a, b) => String(a.fecha_vigencia).localeCompare(String(b.fecha_vigencia)))[0].fecha_vigencia
    : null;

  const incluirReferencia = anteriorVigente && (!primeraFechaMes || primeraFechaMes > inicioMes);
  return [
    ...delMes.map((costo) => ({ ...costo, esReferencia: false })),
    ...(incluirReferencia ? [{ ...anteriorVigente, esReferencia: true }] : []),
  ];
}

function fechasDisponiblesPeriodo(periodo) {
  const match = String(periodo || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return [];
  const anio = Number(match[1]);
  const mes = Number(match[2]);
  const hoy = new Date();
  const periodoActual = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}`;
  if (periodo > periodoActual) return [];
  const ultimoDia = periodo === periodoActual ? hoy.getDate() : new Date(anio, mes, 0).getDate();
  return Array.from({ length: ultimoDia }, (_, i) => `${periodo}-${String(i + 1).padStart(2, "0")}`);
}



function AccordionSection({ titulo, descripcion, icono, abierta, onToggle, children, className = "" }) {
  return (
    <section className={`panel table-panel m2-accordion ${abierta ? "open" : ""} ${className}`.trim()}>
      <button type="button" className="m2-accordion-toggle" onClick={onToggle} aria-expanded={abierta}>
        <div className="m2-accordion-heading">
          <div>
            <h2>{titulo}</h2>
            {descripcion ? <p>{descripcion}</p> : null}
          </div>
          <div className="m2-accordion-actions">
            {icono}
            <ChevronDown size={18} className="m2-accordion-chevron" />
          </div>
        </div>
      </button>
      {abierta ? <div className="m2-accordion-body">{children}</div> : null}
    </section>
  );
}

function Metrica({ titulo, valor, detalle, destacada = false }) {
  return (
    <article className={`metric-card ${destacada ? "featured" : ""}`}>
      <span>{titulo}</span>
      <strong>{valor}</strong>
      <small>{detalle}</small>
    </article>
  );
}

export default function M2Panel({ periodo, onPeriodoChange }) {
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [costosBlueMax, setCostosBlueMax] = useState([]);
  const [fechaCostoBlueMax, setFechaCostoBlueMax] = useState("");
  const [precioCostoBlueMax, setPrecioCostoBlueMax] = useState("");
  const [guardandoBlueMax, setGuardandoBlueMax] = useState(false);
  const [sincronizandoM2, setSincronizandoM2] = useState(false);
  const [progresoM2, setProgresoM2] = useState("");
  const [resultadoSyncM2, setResultadoSyncM2] = useState(null);
  const [modoDiario, setModoDiario] = useState("TODO");
  const [segmentoDiario, setSegmentoDiario] = useState("TODO");
  const [segmentoAsistidas, setSegmentoAsistidas] = useState("ESTANDAR");
  const [segmentoAutoservicio, setSegmentoAutoservicio] = useState("ESTANDAR");
  const [filtroFechaDiario, setFiltroFechaDiario] = useState("");
  const [filtroProductoDiario, setFiltroProductoDiario] = useState("");
  const [ordenDiario, setOrdenDiario] = useState({ campo: "fecha", direccion: "asc" });
  const [seccionesAbiertas, setSeccionesAbiertas] = useState({
    bluemax: false,
    categorias: false,
    asistidas: false,
    autoservicio: false,
    diario: false,
  });

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      setDatos(await obtenerM2(periodo));
    } catch (e) {
      setError(e.message || "No fue posible cargar M2.");
    } finally {
      setCargando(false);
    }
  }, [periodo]);

  const cargarCostosBlueMax = useCallback(async () => {
    try {
      const respuesta = await obtenerCostosBlueMax();
      setCostosBlueMax(respuesta.costos || []);
    } catch (e) {
      setError(e.message || "No fue posible cargar los costos BlueMax.");
    }
  }, []);

  useEffect(() => {
    cargar();
    cargarCostosBlueMax();
  }, [cargar, cargarCostosBlueMax]);

  useEffect(() => {
    setFiltroFechaDiario("");
    setFiltroProductoDiario("");
  }, [periodo]);

  async function guardarBlueMax(e) {
    e.preventDefault();
    setGuardandoBlueMax(true);
    setError("");
    try {
      const respuesta = await guardarCostoBlueMax({
        fechaVigencia: fechaCostoBlueMax,
        precioCosto: precioCostoBlueMax,
      });
      setCostosBlueMax(respuesta.costos || []);
      setFechaCostoBlueMax("");
      setPrecioCostoBlueMax("");
      await cargar();
    } catch (err) {
      setError(err.message || "No fue posible guardar el costo BlueMax.");
    } finally {
      setGuardandoBlueMax(false);
    }
  }

  async function sincronizarHistoricoM2() {
    const fechas = fechasDisponiblesPeriodo(periodo);
    if (fechas.length === 0) return;
    setSincronizandoM2(true);
    setError("");
    setResultadoSyncM2(null);
    const resumen = { dias: 0, ventas: 0, litros: 0, errores: [], diagnosticos: [] };
    try {
      for (let i = 0; i < fechas.length; i += 1) {
        const fecha = fechas[i];
        setProgresoM2(`Procesando ${fecha} · ${i + 1}/${fechas.length}`);
        try {
          const dia = await sincronizarM2LakeDia(fecha);
          resumen.dias += 1;
          resumen.ventas += Number(dia.registros || 0);
          resumen.litros += 0;
          resumen.diagnosticos.push({ fecha, ...(dia.diagnostico || {}), filasResumen: dia.filasResumen || 0, gzipBytes: dia.gzipBytes || 0 });
        } catch (err) {
          resumen.errores.push({ fecha, mensaje: err.message || "Error" });
        }
      }
      setResultadoSyncM2(resumen);
      if (resumen.errores.length > 0) {
        setError(`M2 terminó con ${resumen.errores.length} día(s) con error. Revisa el detalle de sincronización.`);
      }
      await cargar();
    } finally {
      setSincronizandoM2(false);
      setProgresoM2("");
    }
  }

  async function borrarBlueMax(id) {
    if (!window.confirm("¿Eliminar este costo BlueMax? Las ventas afectadas tomarán el costo vigente anterior.")) return;
    setGuardandoBlueMax(true);
    setError("");
    try {
      const respuesta = await eliminarCostoBlueMax(id);
      setCostosBlueMax(respuesta.costos || []);
      await cargar();
    } catch (err) {
      setError(err.message || "No fue posible eliminar el costo BlueMax.");
    } finally {
      setGuardandoBlueMax(false);
    }
  }

  const categorias = useMemo(() => datos?.categorias || [], [datos]);
  const productos = useMemo(() => datos?.productos || [], [datos]);
  const resumenProductos = useMemo(() => resumirProductos(productos), [productos]);
  const productosAsistidos = useMemo(
    () => resumirProductos(productos, "ASISTIDA", segmentoAsistidas),
    [productos, segmentoAsistidas]
  );
  const productosAutoservicio = useMemo(
    () => resumirProductos(productos, "AUTOSERVICIO", segmentoAutoservicio),
    [productos, segmentoAutoservicio]
  );
  const productosAsistidosEstandar = useMemo(
    () => resumirProductos(productos, "ASISTIDA", "ESTANDAR"),
    [productos]
  );
  const resumen = datos?.resumen || {};
  const sinCosto = Number(resumen.lineasSinCosto || 0);

  const m2Asistida = categorias
    .filter((x) => x.tipoVenta === "ASISTIDA")
    .reduce((s, x) => s + Number(x.m2Neto || 0), 0);
  const m2Autoservicio = categorias
    .filter((x) => x.tipoVenta === "AUTOSERVICIO")
    .reduce((s, x) => s + Number(x.m2Neto || 0), 0);
  const m2Taxi = categorias
    .filter((x) => x.segmentoCliente === "TAXI_AMIGO")
    .reduce((s, x) => s + Number(x.m2Neto || 0), 0);

  const resumenCombustibles = resumenProductos
    .filter((x) => x.producto !== "BLUEMAX")
    .reduce((acc, x) => ({ litros: acc.litros + x.litros, m2Neto: acc.m2Neto + x.m2Neto }), { litros: 0, m2Neto: 0 });
  resumenCombustibles.m2Promedio = resumenCombustibles.litros > 0
    ? resumenCombustibles.m2Neto / resumenCombustibles.litros
    : 0;

  const resumenBlueMax = resumenProductos.find((x) => x.producto === "BLUEMAX") || { litros: 0, m2Neto: 0, m2Promedio: 0 };

  const m2Vigentes = useMemo(() => {
    const diarios = agruparDiasProductos(datos?.detalle || [], "ASISTIDA", "ESTANDAR");
    const fechas = [...new Set(diarios.map((fila) => fila.fecha))].filter(Boolean).sort();
    const fechaActual = fechas.at(-1) || null;
    const fechaAnterior = fechas.at(-2) || null;
    const porFechaProducto = new Map(diarios.map((fila) => [`${fila.fecha}|${fila.producto}`, fila]));

    return {
      fechaActual,
      fechaAnterior,
      productos: PRODUCTOS_M2.map((producto) => ({
        producto,
        actual: fechaActual ? porFechaProducto.get(`${fechaActual}|${producto}`)?.m2Litro ?? null : null,
        anterior: fechaAnterior ? porFechaProducto.get(`${fechaAnterior}|${producto}`)?.m2Litro ?? null : null,
        promedio: productosAsistidosEstandar.find((fila) => fila.producto === producto)?.m2Promedio ?? null,
      })),
    };
  }, [datos, productosAsistidosEstandar]);

  const costosBlueMaxVisibles = useMemo(
    () => costosBlueMaxDelPeriodo(costosBlueMax, periodo),
    [costosBlueMax, periodo]
  );

  const filasDiariasBase = useMemo(
    () => agruparDiasProductos(datos?.detalle || [], modoDiario, segmentoDiario),
    [datos, modoDiario, segmentoDiario]
  );
  const fechasDiarias = useMemo(
    () => [...new Set(filasDiariasBase.map((fila) => fila.fecha))].sort(),
    [filasDiariasBase]
  );
  const productosDiarios = useMemo(
    () => PRODUCTOS_M2.filter((producto) => filasDiariasBase.some((fila) => fila.producto === producto)),
    [filasDiariasBase]
  );
  const filasDiarias = useMemo(() => {
    const filtradas = filasDiariasBase.filter((fila) =>
      (!filtroFechaDiario || fila.fecha === filtroFechaDiario) &&
      (!filtroProductoDiario || fila.producto === filtroProductoDiario)
    );
    const { campo, direccion } = ordenDiario;
    const factor = direccion === "desc" ? -1 : 1;
    return [...filtradas].sort((a, b) => {
      const av = a[campo];
      const bv = b[campo];
      if (campo === "fecha" || campo === "producto") return String(av || "").localeCompare(String(bv || "")) * factor;
      return (Number(av || 0) - Number(bv || 0)) * factor;
    });
  }, [filasDiariasBase, filtroFechaDiario, filtroProductoDiario, ordenDiario]);

  function ordenarDiario(campo) {
    setOrdenDiario((actual) => ({
      campo,
      direccion: actual.campo === campo && actual.direccion === "asc" ? "desc" : "asc",
    }));
  }

  function indicadorOrden(campo) {
    if (ordenDiario.campo !== campo) return "";
    return ordenDiario.direccion === "asc" ? " ↑" : " ↓";
  }

  function alternarSeccion(clave) {
    setSeccionesAbiertas((actual) => ({ ...actual, [clave]: !actual[clave] }));
  }

  return (
    <>
      <div className="page-header">
        <div>
          <span className="eyebrow">Margen combustibles</span>
          <h1>M2</h1>
        </div>
        <div className="page-actions">
          <label className="month-filter">
            <span>Mes</span>
            <input
              type="month"
              value={periodo}
              onChange={(e) => onPeriodoChange(e.target.value)}
              disabled={cargando}
            />
          </label>
          <button className="secondary-button button-with-icon" onClick={sincronizarHistoricoM2} disabled={cargando || sincronizandoM2} title="Archivar y procesar M2 del mes en Data Lake">
            <RefreshCw className={sincronizandoM2 ? "spin" : ""} size={16} />
            {sincronizandoM2 ? "Sincronizando M2..." : "Sincronizar M2"}
          </button>
          <button className="icon-button" onClick={cargar} disabled={cargando || sincronizandoM2} title="Actualizar M2">
            <RefreshCw className={cargando ? "spin" : ""} size={17} />
          </button>
        </div>
      </div>

      <section className="panel m2-current-panel">
        <div className="m2-current-header">
          <div>
            <h2>M2 vigente por producto</h2>
            <p>Margen por litro de ventas asistidas estándar, excluyendo Taxi Amigo: último día cargado, día anterior y promedio mensual.</p>
          </div>
          <div className="m2-current-dates">
            <span><strong>Último:</strong> {m2Vigentes.fechaActual ? new Date(`${m2Vigentes.fechaActual}T12:00:00`).toLocaleDateString("es-CL") : "—"}</span>
            <span><strong>Anterior:</strong> {m2Vigentes.fechaAnterior ? new Date(`${m2Vigentes.fechaAnterior}T12:00:00`).toLocaleDateString("es-CL") : "—"}</span>
          </div>
        </div>
        <div className="m2-current-grid">
          {m2Vigentes.productos.map((fila) => (
            <article className="m2-current-card" key={fila.producto}>
              <span className="m2-current-product">{etiquetaProducto(fila.producto)}</span>
              <div className="m2-current-values">
                <div>
                  <small>Último día</small>
                  <strong>{fila.actual == null ? "—" : `${monedaDecimal.format(fila.actual)}/L`}</strong>
                </div>
                <div>
                  <small>Día anterior</small>
                  <strong>{fila.anterior == null ? "—" : `${monedaDecimal.format(fila.anterior)}/L`}</strong>
                </div>
                <div className="m2-current-average-row">
                  <small>Promedio mes</small>
                  <strong>{fila.promedio == null ? "—" : `${monedaDecimal.format(fila.promedio)}/L`}</strong>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      {error ? (
        <div className="feedback error-feedback">
          <AlertCircle size={16} /> {error}
        </div>
      ) : null}

      {progresoM2 ? (
        <div className="feedback info-feedback"><RefreshCw className="spin" size={16} /> {progresoM2}</div>
      ) : null}

      {resultadoSyncM2 ? (
        <div className="feedback info-feedback">
          Sincronización M2 Lake: {numero.format(resultadoSyncM2.dias)} día(s), {numero.format(resultadoSyncM2.ventas)} registro(s) archivado(s).
          {resultadoSyncM2.errores.length ? ` ${resultadoSyncM2.errores.length} día(s) con error.` : " Sin errores."}
        </div>
      ) : null}

      {sinCosto > 0 ? (
        <div className="feedback warning-feedback m2-warning">
          <AlertCircle size={16} />
          {numero.format(sinCosto)} línea(s) no tienen precio costo vigente y no se incluyen en el M2. BlueMax requiere ingresar manualmente su costo vigente en el panel de esta página.
        </div>
      ) : null}

      <section className="cards-grid m2-top-metrics-grid">
        <Metrica
          titulo="M2 total mes"
          valor={moneda.format(resumen.m2Neto || 0)}
          detalle={`${litros.format(resumen.litros || 0)} L · ${numero.format(resumen.transacciones || 0)} transacciones`}
          destacada
        />
        <Metrica titulo="Ventas asistidas" valor={moneda.format(m2Asistida)} detalle="M2 neto asistido" />
        <Metrica titulo="Autoservicio" valor={moneda.format(m2Autoservicio)} detalle="M2 neto autoservicio" />
        <Metrica titulo="Taxi Amigo" valor={moneda.format(m2Taxi)} detalle="Incluye asistido y autoservicio" />
      </section>

      <section className="panel table-panel m2-product-summary-panel">
        <div className="panel-header table-header">
          <div>
            <h2>Resumen M2 por producto</h2>
            <p>Resumen mensual sin separar modalidad de atención ni Taxi Amigo.</p>
          </div>
          <Fuel size={20} />
        </div>

        <div className="m2-summary-kpis">
          <article className="m2-summary-kpi">
            <span>M2 combustibles</span>
            <strong>{moneda.format(resumenCombustibles.m2Neto)}</strong>
            <small>{litros.format(resumenCombustibles.litros)} L · M2 promedio {monedaDecimal.format(resumenCombustibles.m2Promedio)}/L</small>
          </article>
          <article className="m2-summary-kpi">
            <span>M2 BlueMax</span>
            <strong>{moneda.format(resumenBlueMax.m2Neto)}</strong>
            <small>{litros.format(resumenBlueMax.litros)} L · M2 promedio {monedaDecimal.format(resumenBlueMax.m2Promedio)}/L</small>
          </article>
        </div>

        <div className="table-wrapper">
          <table className="data-table daily-table">
            <thead>
              <tr>
                <th>Producto</th>
                <th className="amount-column">Litros</th>
                <th className="amount-column">M2 promedio</th>
                <th className="amount-column">Total M2</th>
              </tr>
            </thead>
            <tbody>
              {resumenProductos.map((fila) => (
                <tr key={fila.producto}>
                  <td><strong className="table-primary">{etiquetaProducto(fila.producto)}</strong></td>
                  <td className="amount-column">{litros.format(fila.litros)}</td>
                  <td className="amount-column">{monedaDecimal.format(fila.m2Promedio)}</td>
                  <td className="amount-column amount-strong">{moneda.format(fila.m2Neto)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <AccordionSection
        titulo="Costo BlueMax granel"
        descripcion="Ingresa el costo bruto por litro y la fecha desde la que comienza a regir. Después de cambiar un costo, sincroniza M2 para reprocesar el período."
        icono={<Fuel size={20} />}
        abierta={seccionesAbiertas.bluemax}
        onToggle={() => alternarSeccion("bluemax")}
        className="m2-bluemax-panel"
      >
        <form className="m2-bluemax-form" onSubmit={guardarBlueMax}>
          <label>
            <span>Fecha vigencia</span>
            <input type="date" value={fechaCostoBlueMax} onChange={(e) => setFechaCostoBlueMax(e.target.value)} required disabled={guardandoBlueMax} />
          </label>
          <label>
            <span>Costo BlueMax $/L</span>
            <input type="number" min="0.001" step="0.001" placeholder="Ej. 615" value={precioCostoBlueMax} onChange={(e) => setPrecioCostoBlueMax(e.target.value)} required disabled={guardandoBlueMax} />
          </label>
          <button className="primary-button" type="submit" disabled={guardandoBlueMax || !fechaCostoBlueMax || !precioCostoBlueMax}>
            <Save size={16} /> {guardandoBlueMax ? "Guardando..." : "Guardar costo"}
          </button>
        </form>
        <div className="table-wrapper">
          <table className="data-table daily-table m2-cost-table">
            <thead><tr><th>Vigente desde</th><th className="amount-column">Costo $/L</th><th className="amount-column">Acción</th></tr></thead>
            <tbody>
              {costosBlueMaxVisibles.map((costo) => (
                <tr key={`${costo.id}-${costo.esReferencia ? "ref" : "mes"}`} className={costo.esReferencia ? "m2-reference-row" : ""}>
                  <td>
                    <strong className="table-primary">{new Date(`${costo.fecha_vigencia}T12:00:00`).toLocaleDateString("es-CL")}</strong>
                    {costo.esReferencia ? <span className="m2-reference-badge">Vigente al iniciar el mes</span> : null}
                  </td>
                  <td className="amount-column">{monedaDecimal.format(Number(costo.precio_costo || 0))}</td>
                  <td className="amount-column">
                    {costo.esReferencia
                      ? <span className="m2-reference-label">Referencia</span>
                      : <button type="button" className="icon-button danger" title="Eliminar costo" onClick={() => borrarBlueMax(costo.id)} disabled={guardandoBlueMax}><Trash2 size={15} /></button>}
                  </td>
                </tr>
              ))}
              {costosBlueMaxVisibles.length === 0 ? <tr><td colSpan="3" className="empty-table-cell">No hay un costo BlueMax vigente para este mes.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </AccordionSection>


      <div className="m2-mode-grid">
        <AccordionSection
          titulo="Ventas asistidas"
          descripcion="Resumen mensual por producto y segmento."
          icono={<Fuel size={20} />}
          abierta={seccionesAbiertas.asistidas}
          onToggle={() => alternarSeccion("asistidas")}
          className="m2-mode-panel"
        >
          <div className="m2-mode-segment-toolbar">
            <span className="m2-daily-filter-label">Segmento</span>
            <div className="m2-daily-tabs" role="tablist" aria-label="Segmento ventas asistidas">
              {[
                ["ESTANDAR", "Venta estándar"],
                ["TAXI_AMIGO", "Taxi Amigo"],
              ].map(([valor, etiqueta]) => (
                <button
                  key={valor}
                  type="button"
                  className={`m2-daily-tab ${segmentoAsistidas === valor ? "active" : ""}`}
                  onClick={() => setSegmentoAsistidas(valor)}
                >
                  {etiqueta}
                </button>
              ))}
            </div>
          </div>
          <div className="table-wrapper">
            <table className="data-table daily-table m2-mode-table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th className="amount-column">Litros</th>
                  <th className="amount-column">M2 promedio</th>
                  <th className="amount-column">Total M2</th>
                </tr>
              </thead>
              <tbody>
                {productosAsistidos.map((fila) => (
                  <tr key={`asistida-${fila.producto}`}>
                    <td><strong className="table-primary">{etiquetaProducto(fila.producto)}</strong></td>
                    <td className="amount-column">{litros.format(fila.litros)}</td>
                    <td className="amount-column">{monedaDecimal.format(fila.m2Promedio)}</td>
                    <td className="amount-column amount-strong">{moneda.format(fila.m2Neto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </AccordionSection>

        <AccordionSection
          titulo="Autoservicio"
          descripcion="Resumen mensual por producto y segmento."
          icono={<Fuel size={20} />}
          abierta={seccionesAbiertas.autoservicio}
          onToggle={() => alternarSeccion("autoservicio")}
          className="m2-mode-panel"
        >
          <div className="m2-mode-segment-toolbar">
            <span className="m2-daily-filter-label">Segmento</span>
            <div className="m2-daily-tabs" role="tablist" aria-label="Segmento autoservicio">
              {[
                ["ESTANDAR", "Venta estándar"],
                ["TAXI_AMIGO", "Taxi Amigo"],
              ].map(([valor, etiqueta]) => (
                <button
                  key={valor}
                  type="button"
                  className={`m2-daily-tab ${segmentoAutoservicio === valor ? "active" : ""}`}
                  onClick={() => setSegmentoAutoservicio(valor)}
                >
                  {etiqueta}
                </button>
              ))}
            </div>
          </div>
          <div className="table-wrapper">
            <table className="data-table daily-table m2-mode-table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th className="amount-column">Litros</th>
                  <th className="amount-column">M2 promedio</th>
                  <th className="amount-column">Total M2</th>
                </tr>
              </thead>
              <tbody>
                {productosAutoservicio.map((fila) => (
                  <tr key={`autoservicio-${fila.producto}`}>
                    <td><strong className="table-primary">{etiquetaProducto(fila.producto)}</strong></td>
                    <td className="amount-column">{litros.format(fila.litros)}</td>
                    <td className="amount-column">{monedaDecimal.format(fila.m2Promedio)}</td>
                    <td className="amount-column amount-strong">{moneda.format(fila.m2Neto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </AccordionSection>
      </div>

      <AccordionSection
        titulo="M2 diario por producto"
        descripcion="Consulta el margen diario de todos los servicios o separa Asistido y Autoservicio."
        icono={<TrendingUp size={20} />}
        abierta={seccionesAbiertas.diario}
        onToggle={() => alternarSeccion("diario")}
        className="m2-daily-panel"
      >
        <div className="m2-daily-toolbar">
          <div className="m2-daily-filter-group">
            <span className="m2-daily-filter-label">Modalidad</span>
            <div className="m2-daily-tabs" role="tablist" aria-label="Modalidad de venta">
              {[
                ["TODO", "Todo"],
                ["ASISTIDA", "Asistido"],
                ["AUTOSERVICIO", "Autoservicio"],
              ].map(([valor, etiqueta]) => (
                <button
                  key={valor}
                  type="button"
                  className={`m2-daily-tab ${modoDiario === valor ? "active" : ""}`}
                  onClick={() => setModoDiario(valor)}
                >
                  {etiqueta}
                </button>
              ))}
            </div>
          </div>
          <div className="m2-daily-filter-group">
            <span className="m2-daily-filter-label">Segmento</span>
            <div className="m2-daily-tabs" role="tablist" aria-label="Segmento de fidelización">
              {[
                ["TODO", "Todo"],
                ["ESTANDAR", "Venta estándar"],
                ["TAXI_AMIGO", "Taxi Amigo"],
              ].map(([valor, etiqueta]) => (
                <button
                  key={valor}
                  type="button"
                  className={`m2-daily-tab ${segmentoDiario === valor ? "active" : ""}`}
                  onClick={() => setSegmentoDiario(valor)}
                >
                  {etiqueta}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="table-wrapper">
          <table className="data-table daily-table m2-daily-filter-table">
            <thead>
              <tr>
                <th>
                  <button type="button" className="m2-sort-button" onClick={() => ordenarDiario("fecha")}>Fecha{indicadorOrden("fecha")}</button>
                  <select className="m2-column-filter" value={filtroFechaDiario} onChange={(e) => setFiltroFechaDiario(e.target.value)}>
                    <option value="">Todas</option>
                    {fechasDiarias.map((fecha) => <option key={fecha} value={fecha}>{new Date(`${fecha}T12:00:00`).toLocaleDateString("es-CL")}</option>)}
                  </select>
                </th>
                <th>
                  <button type="button" className="m2-sort-button" onClick={() => ordenarDiario("producto")}>Producto{indicadorOrden("producto")}</button>
                  <select className="m2-column-filter" value={filtroProductoDiario} onChange={(e) => setFiltroProductoDiario(e.target.value)}>
                    <option value="">Todos</option>
                    {productosDiarios.map((producto) => <option key={producto} value={producto}>{etiquetaProducto(producto)}</option>)}
                  </select>
                </th>
                <th className="amount-column"><button type="button" className="m2-sort-button amount" onClick={() => ordenarDiario("litros")}>Litros{indicadorOrden("litros")}</button></th>
                <th className="amount-column"><button type="button" className="m2-sort-button amount" onClick={() => ordenarDiario("transacciones")}>Transacciones{indicadorOrden("transacciones")}</button></th>
                <th className="amount-column"><button type="button" className="m2-sort-button amount" onClick={() => ordenarDiario("m2Litro")}>M2 / L{indicadorOrden("m2Litro")}</button></th>
                <th className="amount-column"><button type="button" className="m2-sort-button amount" onClick={() => ordenarDiario("m2Neto")}>M2 neto{indicadorOrden("m2Neto")}</button></th>
                <th className="amount-column"><button type="button" className="m2-sort-button amount" onClick={() => ordenarDiario("lineasSinCosto")}>Sin costo{indicadorOrden("lineasSinCosto")}</button></th>
              </tr>
            </thead>
            <tbody>
              {filasDiarias.map((dia) => (
                <tr key={`${modoDiario}-${segmentoDiario}-${dia.fecha}-${dia.producto}`}>
                  <td><strong className="table-primary">{new Date(`${dia.fecha}T12:00:00`).toLocaleDateString("es-CL")}</strong></td>
                  <td>{etiquetaProducto(dia.producto)}</td>
                  <td className="amount-column">{litros.format(dia.litros || 0)}</td>
                  <td className="amount-column">{numero.format(dia.transacciones || 0)}</td>
                  <td className="amount-column">{monedaDecimal.format(dia.m2Litro || 0)}</td>
                  <td className="amount-column amount-strong">{moneda.format(dia.m2Neto || 0)}</td>
                  <td className="amount-column">{numero.format(dia.lineasSinCosto || 0)}</td>
                </tr>
              ))}
              {filasDiarias.length === 0 && !cargando ? (
                <tr><td colSpan="7" className="empty-table-cell">No hay datos para los filtros seleccionados.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </AccordionSection>
    </>
  );
}
