create extension if not exists pgcrypto;

create table if not exists public.copec_facturas_cargos (
  id uuid primary key default gen_random_uuid(),
  identificador_origen text not null unique,
  fecha_movimiento date not null,
  fecha_vencimiento date,
  codigo_eds text not null,
  linea_producto text,
  tipo_documento text,
  numero_documento text,
  factura_sd text,
  clasificacion_origen text,
  estado_origen text,
  monto numeric(18, 2) not null default 0,
  periodo text not null,
  categoria text not null default 'POR_REVISAR',
  categoria_origen text not null default 'regla',
  confianza_categoria numeric(5, 2),
  documento_disponible boolean not null default false,
  documento_revisado boolean not null default false,
  documento_texto text,
  documento_actualizado_en timestamptz,
  datos_origen jsonb not null default '{}'::jsonb,
  sincronizado_en timestamptz not null default now(),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint copec_facturas_categoria_valida check (
    categoria in (
      'COMBUSTIBLES',
      'PRODUCTOS_NO_COMBUSTIBLES',
      'COBROS_FIJOS',
      'MANTENCIONES',
      'POR_REVISAR'
    )
  )
);

create index if not exists idx_copec_facturas_periodo
  on public.copec_facturas_cargos(periodo, fecha_movimiento);

create index if not exists idx_copec_facturas_categoria
  on public.copec_facturas_cargos(categoria, periodo);

create index if not exists idx_copec_facturas_factura_sd
  on public.copec_facturas_cargos(factura_sd);

alter table public.copec_facturas_cargos enable row level security;

comment on table public.copec_facturas_cargos is
  'Facturas cargadas en la cartola del Portal Concesionario Copec, categorizadas sin reemplazar los datos de origen.';

comment on column public.copec_facturas_cargos.categoria_origen is
  'Indica si la categoría proviene de una regla automática, revisión documental o ajuste manual.';
