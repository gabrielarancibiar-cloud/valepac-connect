-- Migracion v3: documentos de ajustes del EE.RR. Productos.
-- Ejecutar una sola vez en Supabase > SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.productos_ajustes_documentos (
  id uuid primary key default gen_random_uuid(),
  periodo text not null,
  tipo text not null check (tipo in ('CARGO', 'NOTA_CREDITO')),
  concepto text not null check (
    concepto in (
      'ROYALTY_AGUAS_LUBRICANTES',
      'ROYALTY_BLUEMAX_BIDON',
      'ROYALTY_BIDONES_COMBUSTIBLE',
      'COBRO_FIJO_VENTA_ISLA',
      'NOTA_CREDITO_CONDICION_COMERCIAL'
    )
  ),
  folio text not null,
  fecha_emision date not null,
  monto numeric(15, 4) not null check (monto > 0),
  observacion text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint productos_ajustes_documentos_periodo_valido
    check (periodo ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  constraint productos_ajustes_documentos_unico
    unique (periodo, tipo, concepto, folio)
);

create index if not exists idx_productos_ajustes_documentos_periodo
  on public.productos_ajustes_documentos(periodo, fecha_emision);

alter table public.productos_ajustes_documentos enable row level security;

comment on table public.productos_ajustes_documentos is
  'Facturas de royalty, cobros fijos y notas de credito del EE.RR. mensual.';
