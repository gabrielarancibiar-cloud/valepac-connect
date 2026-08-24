import { useEffect, useMemo, useState } from "react";
import { FileMinus2, FileText, Plus, Save, Trash2, X } from "lucide-react";
import { guardarAjustesProductos } from "../services/productosEerrApi.js";

const CONCEPTOS_CARGO = [
  ["ROYALTY_AGUAS_LUBRICANTES", "Royalty Aguas y Lubricantes"],
  ["ROYALTY_BLUEMAX_BIDON", "Royalty Bluemax Bidón"],
  ["ROYALTY_BIDONES_COMBUSTIBLE", "Royalty Bidones Combustible"],
  ["COBRO_FIJO_VENTA_ISLA", 'Cobro fijo "Venta en Isla"'],
];
const CONCEPTO_NOTA = "NOTA_CREDITO_CONDICION_COMERCIAL";
const moneda = new Intl.NumberFormat("es-CL", {
  style: "currency", currency: "CLP", maximumFractionDigits: 0,
});

function montoNumero(valor) {
  const cadena = String(valor ?? "").replace(/\$/g, "").replace(/\s/g, "").trim();
  if (!cadena) return 0;
  let normalizado = cadena;
  if (cadena.includes(",") && cadena.includes(".")) normalizado = cadena.replace(/\./g, "").replace(",", ".");
  else if (cadena.includes(",")) normalizado = cadena.replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(cadena)) normalizado = cadena.replace(/\./g, "");
  const numero = Number(normalizado);
  return Number.isFinite(numero) ? numero : 0;
}

function filaVacia(concepto, tipo) {
  return { id: `nuevo-${crypto.randomUUID()}`, concepto, tipo, folio: "", fechaEmision: "", monto: "", observacion: "" };
}

function prepararFilas(documentos = []) {
  const existentes = documentos.map((documento) => ({
    ...documento,
    monto: String(documento.monto || ""),
  }));
  const cargos = CONCEPTOS_CARGO.map(([concepto]) =>
    existentes.find((documento) => documento.concepto === concepto) || filaVacia(concepto, "CARGO")
  );
  const notas = existentes.filter((documento) => documento.concepto === CONCEPTO_NOTA);
  return { cargos, notas };
}

function DocumentoFila({ documento, etiqueta, onChange, onEliminar, eliminable }) {
  return (
    <div className="eerr-document-row">
      <div className="eerr-document-concept">
        <strong>{etiqueta}</strong>
        <span>{documento.tipo === "CARGO" ? "Factura / cobro" : "Nota de crédito"}</span>
        {documento.tipo === "NOTA_CREDITO" ? (
          <label className="eerr-document-description">
            <span>Descripción breve</span>
            <input type="text" maxLength={160} value={documento.observacion || ""} onChange={(evento) => onChange("observacion", evento.target.value)} placeholder="Ej.: Descuento comercial julio" />
          </label>
        ) : null}
      </div>
      <label><span>Folio</span><input type="text" value={documento.folio} onChange={(evento) => onChange("folio", evento.target.value)} placeholder="Número de folio" /></label>
      <label><span>Fecha de emisión</span><input type="date" value={documento.fechaEmision} onChange={(evento) => onChange("fechaEmision", evento.target.value)} /></label>
      <label><span>Monto</span><div className="eerr-document-money"><b>$</b><input type="text" inputMode="numeric" value={documento.monto} onChange={(evento) => onChange("monto", evento.target.value)} placeholder="0" /></div></label>
      {eliminable ? <button type="button" className="eerr-document-delete" onClick={onEliminar} title="Eliminar nota de crédito"><Trash2 size={17} /></button> : <span className="eerr-document-placeholder" />}
    </div>
  );
}

export default function ProductosAjustesModal({
  abierto,
  periodo,
  documentos,
  margenOperacional,
  incompleto,
  onCerrar,
  onGuardado,
}) {
  const [filas, setFilas] = useState(() => prepararFilas(documentos));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (abierto) {
      setFilas(prepararFilas(documentos));
      setError("");
    }
  }, [abierto, documentos]);

  useEffect(() => {
    if (!abierto) return undefined;
    const anterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = anterior; };
  }, [abierto]);

  const actualizar = (grupo, indice, campo, valor) => {
    setFilas((actual) => ({
      ...actual,
      [grupo]: actual[grupo].map((fila, posicion) =>
        posicion === indice ? { ...fila, [campo]: valor } : fila
      ),
    }));
  };

  const totales = useMemo(() => {
    const cargos = filas.cargos.reduce((total, fila) => total + montoNumero(fila.monto), 0);
    const notas = filas.notas.reduce((total, fila) => total + montoNumero(fila.monto), 0);
    return { cargos, notas, final: Number(margenOperacional || 0) - cargos + notas };
  }, [filas, margenOperacional]);

  const guardar = async () => {
    setError("");
    const todas = [...filas.cargos, ...filas.notas];
    const completas = todas.filter((fila) => fila.folio || fila.fechaEmision || montoNumero(fila.monto) > 0);
    const incompleta = completas.find((fila) => !fila.folio || !fila.fechaEmision || montoNumero(fila.monto) <= 0);
    if (incompleta) {
      setError("Cada documento informado debe tener folio, fecha de emisión y monto mayor que cero.");
      return;
    }
    setGuardando(true);
    try {
      const resultado = await guardarAjustesProductos({
        periodo,
        documentos: completas.map((fila) => ({
          id: String(fila.id).startsWith("nuevo-") ? undefined : fila.id,
          tipo: fila.tipo,
          concepto: fila.concepto,
          folio: fila.folio.trim(),
          fechaEmision: fila.fechaEmision,
          monto: montoNumero(fila.monto),
          observacion: String(fila.observacion || "").trim() || null,
        })),
      });
      await onGuardado?.(resultado);
      onCerrar();
    } catch (errorGuardado) {
      setError(errorGuardado.message || "No fue posible guardar los documentos.");
    } finally {
      setGuardando(false);
    }
  };

  if (!abierto) return null;

  return (
    <div className="eerr-documents-overlay" role="presentation" onMouseDown={(evento) => {
      if (evento.target === evento.currentTarget && !guardando) onCerrar();
    }}>
      <section className="eerr-documents-modal" role="dialog" aria-modal="true" aria-labelledby="eerr-documents-title">
        <header><div><span className="eyebrow">Ajustes del total general</span><h2 id="eerr-documents-title">Facturas y notas de crédito</h2><p>Aplicados al periodo {periodo}. La fecha de emisión puede pertenecer a cualquier mes para admitir documentos retroactivos.</p></div><button type="button" onClick={onCerrar} disabled={guardando} aria-label="Cerrar"><X size={20} /></button></header>
        {error ? <div className="feedback error-feedback">{error}</div> : null}
        <div className="eerr-documents-body">
          <section><div className="eerr-documents-section-title"><FileText size={19} /><div><h3>Cobros y royalty</h3><p>Se descuentan del margen operacional.</p></div></div>{filas.cargos.map((fila, indice) => <DocumentoFila key={fila.id} documento={fila} etiqueta={CONCEPTOS_CARGO[indice][1]} onChange={(campo, valor) => actualizar("cargos", indice, campo, valor)} />)}</section>
          <section><div className="eerr-documents-section-title"><FileMinus2 size={19} /><div><h3>Notas de crédito</h3><p>Descuento Condición Comercial. Se suman al resultado.</p></div><button type="button" className="secondary-button button-with-icon" onClick={() => setFilas((actual) => ({ ...actual, notas: [...actual.notas, filaVacia(CONCEPTO_NOTA, "NOTA_CREDITO")] }))}><Plus size={16} />Agregar nota</button></div>{filas.notas.length === 0 ? <div className="eerr-documents-empty">No hay notas de crédito informadas.</div> : filas.notas.map((fila, indice) => <DocumentoFila key={fila.id} documento={fila} etiqueta={`Nota de crédito ${indice + 1}`} onChange={(campo, valor) => actualizar("notas", indice, campo, valor)} onEliminar={() => setFilas((actual) => ({ ...actual, notas: actual.notas.filter((_, posicion) => posicion !== indice) }))} eliminable />)}</section>
        </div>
        <footer><div><span>Margen operacional<strong>{incompleto ? "Pendiente" : moneda.format(margenOperacional || 0)}</strong></span><span>Cobros<strong className="negative">− {moneda.format(totales.cargos)}</strong></span><span>Notas de crédito<strong className="positive">+ {moneda.format(totales.notas)}</strong></span><span className="final">Resultado final<strong>{incompleto ? "Pendiente" : moneda.format(totales.final)}</strong></span></div><button type="button" className="primary-button button-with-icon" onClick={guardar} disabled={guardando}><Save size={17} />{guardando ? "Guardando…" : "Guardar documentos"}</button></footer>
      </section>
    </div>
  );
}
