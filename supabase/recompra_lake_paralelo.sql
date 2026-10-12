-- VALEPAC Connect · Recompra Lake · fase paralela
-- No elimina ni modifica recompra_ventas.
-- Crea únicamente las estructuras livianas que se alimentan desde el JSON
-- VENTA_COMBUSTIBLE ya archivado en Data Lake.

create table if not exists public.recompra_resumen_diario (
  fecha date primary key,
  codigo_eds text,
  cantidad_operaciones integer not null default 0,
  lineas integer not null default 0,
  litros_base numeric(18,3) not null default 0,
  monto_venta_referencia numeric(18,2) not null default 0,
  formas_pago jsonb not null default '{}'::jsonb,
  productos jsonb not null default '{}'::jsonb,
  actualizado_en timestamptz not null default now()
);

create table if not exists public.recompra_estado_diario (
  fecha date primary key,
  estado text not null default 'PROCESADO',
  fuente text not null default 'COPECFUEL_VENTA_COMBUSTIBLE',
  storage_path text,
  sha256 text,
  cantidad_registros integer not null default 0,
  ventas_elegibles integer not null default 0,
  ventas_unicas integer not null default 0,
  duplicadas integer not null default 0,
  excluidas integer not null default 0,
  coseducam_lineas integer not null default 0,
  capturado_en timestamptz,
  procesado_en timestamptz,
  actualizado_en timestamptz not null default now(),
  diagnostico jsonb not null default '{}'::jsonb
);

create table if not exists public.coseducam_consumos (
  identificador_origen text primary key,
  fecha date not null,
  codigo_eds text,
  transaccion_id text not null,
  transaccion_codigo text,
  producto text not null default 'DIESEL',
  litros numeric(18,3) not null default 0,
  patente text,
  actualizado_en timestamptz not null default now()
);

create index if not exists recompra_resumen_diario_fecha_idx
  on public.recompra_resumen_diario (fecha);

create index if not exists recompra_estado_diario_fecha_idx
  on public.recompra_estado_diario (fecha);

create index if not exists coseducam_consumos_fecha_idx
  on public.coseducam_consumos (fecha);

create index if not exists coseducam_consumos_transaccion_idx
  on public.coseducam_consumos (transaccion_id);

alter table public.recompra_resumen_diario enable row level security;
alter table public.recompra_estado_diario enable row level security;
alter table public.coseducam_consumos enable row level security;

-- Sin políticas anon/authenticated: estas tablas se consumen desde las APIs
-- server-side de VALEPAC mediante service role.

select
  pg_size_pretty(pg_total_relation_size('public.recompra_resumen_diario')) as tamano_resumen,
  pg_size_pretty(pg_total_relation_size('public.recompra_estado_diario')) as tamano_estado,
  pg_size_pretty(pg_total_relation_size('public.coseducam_consumos')) as tamano_coseducam;
