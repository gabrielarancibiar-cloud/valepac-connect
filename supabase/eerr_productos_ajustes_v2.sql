-- Migracion v2 para instalaciones existentes de EE.RR. Productos.
-- Ejecutar una sola vez en Supabase > SQL Editor.

create table if not exists public.productos_ajustes_mensuales (
  periodo text primary key,
  royalty numeric(15, 4) not null default 0 check (royalty >= 0),
  notas_credito numeric(15, 4) not null default 0 check (notas_credito >= 0),
  observacion text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint productos_ajustes_periodo_valido
    check (periodo ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);

alter table public.productos_ajustes_mensuales enable row level security;

comment on table public.productos_ajustes_mensuales is
  'Royalty y notas de credito aplicados solo al resultado general mensual.';
