-- VALEPAC Connect: preparación aislada, sin emisión TAE ni confirmación EnRuta.
-- No modifica coseducam_jobs, coseducam_guias ni programaciones de cron.
-- Ejecutar con el propietario de la base (SQL Editor / migraciones de Supabase).
begin;

create table if not exists public.coseducam_preparaciones (
  id bigint generated always as identity primary key,
  fecha date not null check (fecha >= date '2026-10-15'),
  codigo_eds text not null check (codigo_eds = '40098'),
  estado text not null default 'PREPARADA' check (estado = 'PREPARADA'),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  creada_en timestamptz not null default clock_timestamp(),
  unique (fecha, codigo_eds)
);

create table if not exists public.coseducam_preparacion_eventos (
  id bigint generated always as identity primary key,
  fecha date not null check (fecha >= date '2026-10-15'),
  codigo_eds text not null check (codigo_eds = '40098'),
  preparacion_id bigint references public.coseducam_preparaciones(id),
  estado_control text not null check (estado_control in (
    'BLOQUEADA_REVISION', 'ESPERANDO_CONSUMO', 'ESPERANDO_PRECIO',
    'PREPARADA', 'DATOS_CAMBIARON'
  )),
  evidencia jsonb not null check (jsonb_typeof(evidencia) = 'object'),
  creada_en timestamptz not null default clock_timestamp()
);

create index if not exists coseducam_preparacion_eventos_fecha_idx
  on public.coseducam_preparacion_eventos (fecha, codigo_eds, id);

-- El snapshot y la auditoría son de solo anexado, también para service_role.
create or replace function public.coseducam_preparacion_inmutable_v1()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'La preparación y su evidencia son inmutables; requieren revisión manual.'
    using errcode = '55000';
end;
$$;

drop trigger if exists coseducam_preparacion_inmutable on public.coseducam_preparaciones;
create trigger coseducam_preparacion_inmutable
before update or delete on public.coseducam_preparaciones
for each row execute function public.coseducam_preparacion_inmutable_v1();

drop trigger if exists coseducam_preparacion_evento_inmutable on public.coseducam_preparacion_eventos;
create trigger coseducam_preparacion_evento_inmutable
before update or delete on public.coseducam_preparacion_eventos
for each row execute function public.coseducam_preparacion_inmutable_v1();

alter table public.coseducam_preparaciones enable row level security;
alter table public.coseducam_preparacion_eventos enable row level security;
revoke all on public.coseducam_preparaciones from public, anon, authenticated, service_role;
revoke all on public.coseducam_preparacion_eventos from public, anon, authenticated, service_role;
revoke all on sequence public.coseducam_preparaciones_id_seq from public, anon, authenticated, service_role;
revoke all on sequence public.coseducam_preparacion_eventos_id_seq from public, anon, authenticated, service_role;
grant select on public.coseducam_preparaciones, public.coseducam_preparacion_eventos to service_role;
revoke all on function public.coseducam_preparacion_inmutable_v1() from public, anon, authenticated, service_role;

create or replace function public.coseducam_preparar_v1(
  p_fecha date,
  p_guardar boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
set lock_timeout = '3s'
set statement_timeout = '8s'
as $$
declare
  v_eds constant text := '40098';
  v_hoy date := (statement_timestamp() at time zone 'America/Santiago')::date;
  v_jobs jsonb;
  v_guias jsonb;
  v_consumos jsonb;
  v_precios jsonb;
  v_job jsonb;
  v_guia jsonb;
  v_fila jsonb;
  v_observado jsonb;
  v_precio jsonb := null;
  v_precio_valido boolean := false;
  v_precio_ambiguo boolean := false;
  v_consumos_validos boolean := true;
  v_litros numeric := 0;
  v_registros integer;
  v_estado text;
  v_motivo text;
  v_snapshot jsonb;
  v_evidencia jsonb;
  v_preparacion public.coseducam_preparaciones%rowtype;
  v_tiene_preparacion boolean := false;
  v_nueva boolean := false;
  v_inicio timestamptz := clock_timestamp();
begin
  if p_fecha is null or p_fecha < date '2026-10-15' or p_fecha > v_hoy then
    raise exception 'Fecha fuera del periodo autorizado: 2026-10-15 hasta hoy en Chile.'
      using errcode = '22023';
  end if;
  if p_guardar is null then
    raise exception 'p_guardar debe ser booleano.' using errcode = '22023';
  end if;

  if p_guardar then
    -- Serializa la clave de preparación y protege también contra inserciones
    -- de guías/jobs y cambios de consumos/precio durante esta transacción.
    -- Un lock de fila/advisory por sí solo no protege contra nuevos registros
    -- de los procesos antiguos. lock_timeout limita la ESPERA, no cuánto
    -- duran los locks adquiridos; se liberan al finalizar la transacción.
    perform pg_advisory_xact_lock(40098, p_fecha - date '2026-10-15');
    lock table public.coseducam_jobs, public.coseducam_guias,
      public.coseducam_consumos, public.copecfuel_resumenes in share mode;
  end if;

  -- Una sola lectura obtiene un snapshot consistente de las cuatro fuentes.
  -- De las tablas antiguas solo se presuponen fecha y codigo_eds, ya usadas
  -- por el controlador. Los otros campos de jobs/guías se leen como JSON.
  select
    coalesce((select jsonb_agg(to_jsonb(j) order by to_jsonb(j)::text)
      from public.coseducam_jobs j where j.fecha = p_fecha and j.codigo_eds::text = v_eds), '[]'::jsonb),
    coalesce((select jsonb_agg(to_jsonb(g) order by to_jsonb(g)::text)
      from public.coseducam_guias g where g.fecha = p_fecha and g.codigo_eds::text = v_eds), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object(
        'identificadorOrigen', to_jsonb(c) -> 'identificador_origen', 'transaccionId', c.transaccion_id::text,
        'producto', upper(btrim(c.producto::text)), 'litros', c.litros
      ) order by c.transaccion_id::text, c.producto, c.litros,
        to_jsonb(c) ->> 'identificador_origen')
      from public.coseducam_consumos c where c.fecha = p_fecha and c.codigo_eds::text = v_eds), '[]'::jsonb),
    coalesce((select jsonb_agg(p.d order by p.sincronizado_en desc nulls first, p.d::text)
      from (
        select r.d, r.sincronizado_en from (
          select jsonb_build_object(
            'sincronizadoEn', r.sincronizado_en,
            'observado', r.datos_origen -> 'precioDieselObservado'
          ) as d, r.sincronizado_en,
          dense_rank() over (order by r.sincronizado_en desc nulls first) as orden
          from public.copecfuel_resumenes r
          where r.fecha_desde = p_fecha and r.fecha_hasta = p_fecha
            and r.codigo_eds::text = v_eds
            and r.datos_origen ->> 'fuente' = 'API_OFICIAL_VENTAS_COPECFUEL'
        ) r where r.orden = 1
        -- Un sincronizado_en nulo es evidencia inválida, nunca permite
        -- recurrir silenciosamente a un resumen anterior que sí tenía precio.
      ) p), '[]'::jsonb)
  into v_jobs, v_guias, v_consumos, v_precios;

  select * into v_preparacion from public.coseducam_preparaciones
    where fecha = p_fecha and codigo_eds = v_eds;
  v_tiene_preparacion := found;

  if jsonb_array_length(v_jobs) = 1 then
    v_fila := v_jobs -> 0;
    v_job := jsonb_build_object(
      'id', v_fila -> 'id', 'fecha', p_fecha, 'codigo_eds', v_eds,
      'estado', v_fila -> 'estado', 'etapa_previa', v_fila -> 'etapa_previa',
      'litros_calculados', v_fila -> 'litros_calculados', 'litros_guia', v_fila -> 'litros_guia',
      'precio_aplicado', v_fila -> 'precio_aplicado', 'numero_guia', v_fila -> 'numero_guia',
      'intentos_tae', v_fila -> 'intentos_tae', 'intentos_enruta', v_fila -> 'intentos_enruta'
    );
  end if;
  if jsonb_array_length(v_guias) > 0 then
    v_fila := v_guias -> 0;
    v_guia := jsonb_build_object(
      'id', v_fila -> 'id', 'fecha', p_fecha, 'codigo_eds', v_eds,
      'estado', v_fila -> 'estado', 'numero_guia', v_fila -> 'numero_guia',
      'creada_en', v_fila -> 'creada_en', 'confirmada_en', v_fila -> 'confirmada_en'
    );
  end if;

  v_registros := jsonb_array_length(v_consumos);
  for v_fila in select value from jsonb_array_elements(v_consumos) loop
    -- No convertir null/texto/NaN/negativos en cero ni omitir filas inválidas.
    if jsonb_typeof(v_fila -> 'litros') is distinct from 'number'
      or length(v_fila ->> 'litros') > 32
      or (v_fila ->> 'litros') !~ '^[0-9]+([.][0-9]+)?$'
      or jsonb_typeof(v_fila -> 'transaccionId') is distinct from 'string'
      or nullif(btrim(v_fila ->> 'transaccionId'), '') is null
      or v_fila ->> 'producto' is distinct from 'DIESEL'
    then
      v_consumos_validos := false;
    elsif (v_fila ->> 'litros')::numeric <= 0 then
      v_consumos_validos := false;
    else
      v_litros := v_litros + (v_fila ->> 'litros')::numeric;
    end if;
  end loop;
  if not v_consumos_validos or v_litros > 9007199254740991 then
    v_consumos_validos := false;
    v_litros := null;
  end if;

  v_observado := v_precios -> 0 -> 'observado';
  select count(distinct value -> 'observado') > 1 into v_precio_ambiguo
    from jsonb_array_elements(v_precios);
  -- El valor ya fue calculado como moda diaria por reporteVentas.js. Aquí no
  -- se recalcula ni se sustituye por precio de costo, vigencia o importe/litros.
  if not v_precio_ambiguo
    and jsonb_typeof(v_precios -> 0 -> 'sincronizadoEn') = 'string'
    and jsonb_typeof(v_observado) = 'object'
    and jsonb_typeof(v_observado -> 'precio') = 'number'
    and length(v_observado ->> 'precio') <= 32
    and (v_observado ->> 'precio') ~ '^[0-9]+([.][0-9]+)?$'
    and jsonb_typeof(v_observado -> 'repeticiones') = 'number'
    and (v_observado ->> 'repeticiones') ~ '^[0-9]{1,10}$'
    and jsonb_typeof(v_observado -> 'transaccionesRevisadas') = 'number'
    and (v_observado ->> 'transaccionesRevisadas') ~ '^[0-9]{1,10}$'
    and jsonb_typeof(v_observado -> 'preciosDistintos') = 'number'
    and (v_observado ->> 'preciosDistintos') ~ '^[0-9]{1,10}$'
  then
    if (v_observado ->> 'precio')::numeric > 0
      and (v_observado ->> 'precio')::numeric <= 9007199254740991
      and (v_observado ->> 'repeticiones')::numeric > 0
      and (v_observado ->> 'transaccionesRevisadas')::numeric >= (v_observado ->> 'repeticiones')::numeric
      and (v_observado ->> 'preciosDistintos')::numeric > 0
      and (v_observado ->> 'preciosDistintos')::numeric <= (v_observado ->> 'transaccionesRevisadas')::numeric
    then
      v_precio_valido := true;
      v_precio := jsonb_build_object(
        'precio', (v_observado ->> 'precio')::numeric,
        'repeticiones', (v_observado ->> 'repeticiones')::numeric,
        'transaccionesRevisadas', (v_observado ->> 'transaccionesRevisadas')::numeric,
        'preciosDistintos', (v_observado ->> 'preciosDistintos')::numeric,
        'sincronizadoEn', v_precios -> 0 -> 'sincronizadoEn'
      );
    end if;
  end if;

  v_snapshot := jsonb_build_object(
    'version', 1, 'fecha', p_fecha, 'codigoEds', v_eds,
    'fuentePrecio', 'API_OFICIAL_VENTAS_COPECFUEL',
    'criterioPrecio', 'Moda diaria Diesel en ventas ASISTIDO con litros y total positivos; calculada por reporteVentas.js.',
    'consumos', v_consumos, 'litros', v_litros,
    'precioDieselObservado', v_precio, 'job', v_job, 'guia', v_guia
  );

  -- Un presupuesto excedido nunca debe producir una escritura parcial.
  -- statement_timeout debe fijarse también en la conexión/rol de despliegue:
  -- su SET dentro de una función no rearma el temporizador del SELECT activo.
  if p_guardar and clock_timestamp() - v_inicio > interval '8 seconds' then
    raise exception 'Preparación excedió el tiempo de control; reintentar sin emisión.'
      using errcode = '57014';
  end if;

  if jsonb_array_length(v_jobs) > 1 or jsonb_array_length(v_guias) > 1 then
    v_estado := 'BLOQUEADA_REVISION'; v_motivo := 'JOBS_O_GUIAS_DUPLICADOS';
  elsif jsonb_array_length(v_guias) > 0 then
    v_estado := 'BLOQUEADA_REVISION'; v_motivo := 'GUIA_EXISTENTE';
  elsif v_job is not null and (
    v_job ->> 'estado' is distinct from 'pendiente'
    or v_job ->> 'intentos_tae' is distinct from '0'
    or v_job ->> 'intentos_enruta' is distinct from '0'
    or nullif(btrim(v_job ->> 'numero_guia'), '') is not null
  ) then
    v_estado := 'BLOQUEADA_REVISION'; v_motivo := 'JOB_EXISTENTE_NO_SEGURO';
  elsif v_tiene_preparacion and
    (v_preparacion.snapshot #- '{precioDieselObservado,sincronizadoEn}')
      is distinct from (v_snapshot #- '{precioDieselObservado,sincronizadoEn}') then
    -- Una resincronización idéntica puede cambiar su hora: queda auditada,
    -- pero no altera el snapshot ni invalida datos de negocio idénticos.
    v_estado := 'DATOS_CAMBIARON'; v_motivo := 'SNAPSHOT_EXISTENTE_DISTINTO';
  elsif not v_consumos_validos then
    v_estado := 'BLOQUEADA_REVISION'; v_motivo := 'CONSUMOS_INVALIDOS';
  elsif v_registros = 0 then
    -- Ausencia de filas no acredita un día completo sin consumo.
    v_estado := 'ESPERANDO_CONSUMO'; v_motivo := 'SIN_CONSUMOS_ACREDITADOS';
  elsif not v_precio_valido then
    v_estado := 'ESPERANDO_PRECIO'; v_motivo := 'ULTIMO_PRECIO_OBSERVADO_INVALIDO_O_AUSENTE';
  elsif v_tiene_preparacion then
    v_estado := 'PREPARADA'; v_motivo := 'IDEMPOTENTE';
  elsif not p_guardar then
    v_estado := 'LISTA_PARA_PREPARAR'; v_motivo := 'CONSULTA_SIN_ESCRITURA';
  else
    insert into public.coseducam_preparaciones (fecha, codigo_eds, snapshot)
      values (p_fecha, v_eds, v_snapshot) returning * into v_preparacion;
    v_tiene_preparacion := true;
    v_nueva := true;
    v_estado := 'PREPARADA'; v_motivo := 'SNAPSHOT_CREADO';
  end if;

  if p_guardar then
    v_evidencia := jsonb_build_object(
      'motivo', v_motivo, 'snapshotEvaluado', v_snapshot,
      'cantidadJobs', jsonb_array_length(v_jobs), 'cantidadGuias', jsonb_array_length(v_guias),
      'evidenciaPrecio', jsonb_build_object(
        'fuente', 'API_OFICIAL_VENTAS_COPECFUEL', 'fechaDesde', p_fecha,
        'fechaHasta', p_fecha, 'codigoEds', v_eds,
        'sincronizadoEn', v_precios -> 0 -> 'sincronizadoEn',
        'observado', jsonb_build_object(
          'precio', v_observado -> 'precio', 'repeticiones', v_observado -> 'repeticiones',
          'transaccionesRevisadas', v_observado -> 'transaccionesRevisadas',
          'preciosDistintos', v_observado -> 'preciosDistintos'
        ), 'ambiguo', v_precio_ambiguo
      ),
      'nuevaPreparacion', v_nueva,
      'emisionHabilitada', false, 'confirmacionHabilitada', false
    );
    insert into public.coseducam_preparacion_eventos (
      fecha, codigo_eds, preparacion_id, estado_control, evidencia
    ) values (p_fecha, v_eds,
      case when v_tiene_preparacion then v_preparacion.id else null end,
      v_estado, v_evidencia);
  end if;

  return jsonb_build_object(
    'fecha', p_fecha, 'codigoEds', v_eds, 'job', v_job, 'guia', v_guia,
    'consumo', jsonb_build_object('litros', v_litros, 'registros', v_registros, 'precioDieselObservado', v_precio),
    'estadoControl', v_estado, 'motivo', v_motivo,
    'preparacion', case when v_tiene_preparacion then jsonb_build_object(
      'id', v_preparacion.id, 'fecha', v_preparacion.fecha, 'codigoEds', v_preparacion.codigo_eds,
      'estado', v_preparacion.estado, 'creadaEn', v_preparacion.creada_en, 'snapshot', v_preparacion.snapshot
    ) else null end,
    -- Guardar también anexa un evento en casos bloqueados/idempotentes.
    'modificoDatos', p_guardar,
    'emisionHabilitada', false, 'confirmacionHabilitada', false
  );
end;
$$;

revoke all on function public.coseducam_preparar_v1(date, boolean) from public, anon, authenticated;
grant execute on function public.coseducam_preparar_v1(date, boolean) to service_role;

comment on table public.coseducam_preparaciones is
  'Preparaciones inmutables aisladas del emisor antiguo. No son coseducam_jobs ni autorizan emisión/confirmación.';
comment on function public.coseducam_preparar_v1(date, boolean) is
  'Control y preparación aislada desde 2026-10-15 para EDS 40098. p_guardar=false no escribe; true anexa auditoría y prepara solo si es seguro. Sin cron ni efectos externos.';

commit;
