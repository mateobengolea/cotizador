-- =====================================================================
--  Cotizaciones directas + Comparativas  (Meta)
--  Pegar TODO este archivo en Supabase → SQL Editor → Run.
--  Tablas con prefijo cc_ para no mezclarse con las del cotizador.
--  Se puede volver a correr sin romper nada (usa IF NOT EXISTS).
-- =====================================================================

-- ---------- Cotizaciones (un registro por proceso / expediente) ----------
create table if not exists cc_cotizaciones (
  id          bigint generated always as identity primary key,
  proceso     text not null unique,          -- ej: "EXPTE 250420"
  apertura    text,                          -- ej: "30/09/2026 - 10:00hs" (texto libre, como en el Excel)
  fecha       date,                          -- fecha de apertura (para ordenar / filtrar por mes)
  hoja        text,                          -- pestaña de la planilla, ej. "OCTUBRE 2026" 
  cliente     text default 'ISSN',
  estado      text not null default 'abierta',  -- abierta | presentada | adjudicada | parcial | perdida | desierta
  oc          text,
  condicion   text,
  mant_oferta text,
  vto_oferta  date,
  obs         text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  text
);

alter table cc_cotizaciones add column if not exists hoja text;

-- ---------- Renglones cotizados ----------
create table if not exists cc_items (
  id            bigint generated always as identity primary key,
  cotizacion_id bigint not null references cc_cotizaciones(id) on delete cascade,
  renglon       integer,
  cantidad      numeric,
  lista         text,
  codigo        text,
  detalle       text,
  monodroga     text,
  laboratorio   text,
  pvp           numeric,        -- valores AL MOMENTO de cotizar (foto)
  psl           numeric,
  dtocpa        numeric,
  costo         numeric,
  stock         text,
  obs           text,
  plazo         numeric,
  dcto_pvp      numeric,        -- Dcto. acordado sobre PVP (%)
  dcto_psl      numeric,        -- Dcto. acordado sobre PSL (%)  → Costo META = PSL × (1 − dcto)
  margen        numeric,        -- R [%] como fracción (0.05 = 5 %)
  precio_unit   numeric,        -- Pcio. VENTA (redondeado)
  adjudicado    boolean,        -- null = sin dato, true = ganado, false = perdido
  oc            text,
  orden         integer,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists cc_items_cot_idx    on cc_items(cotizacion_id);
create index if not exists cc_items_codigo_idx on cc_items(codigo);
create index if not exists cc_items_mono_idx   on cc_items(monodroga);

-- ---------- Costos vigentes (se reemplazan con cada carga) ----------
create table if not exists cc_costos (
  codigo      text not null,
  lista       text not null default '',
  detalle     text,
  monodroga   text,
  laboratorio text,
  pvp         numeric,
  psl         numeric,
  dtocpa      numeric,
  costo       numeric,
  actualizado timestamptz not null default now(),
  primary key (codigo, lista)
);

create table if not exists cc_cargas_costos (
  id         bigint generated always as identity primary key,
  archivo    text,
  filas      integer,
  listas     text,
  usuario    text,
  created_at timestamptz not null default now()
);

-- ---------- Comparativas (actas) ----------
create table if not exists cc_comparativas (
  id            bigint generated always as identity primary key,
  cotizacion_id bigint references cc_cotizaciones(id) on delete set null,
  proceso       text,
  fecha         date,
  titulo        text,
  archivo       text,
  origen        text default 'acta',   -- acta | historico
  created_at    timestamptz not null default now(),
  created_by    text
);
create index if not exists cc_comp_cot_idx on cc_comparativas(cotizacion_id);

create table if not exists cc_comp_renglones (
  id             bigint generated always as identity primary key,
  comparativa_id bigint not null references cc_comparativas(id) on delete cascade,
  renglon        integer,
  descripcion    text,
  cantidad       numeric,
  item_id        bigint references cc_items(id) on delete set null,  -- vínculo con nuestro renglón cotizado
  vinculo_manual boolean default false
);
create index if not exists cc_compr_comp_idx on cc_comp_renglones(comparativa_id);
create index if not exists cc_compr_item_idx on cc_comp_renglones(item_id);

create table if not exists cc_comp_ofertas (
  id           bigint generated always as identity primary key,
  renglon_id   bigint not null references cc_comp_renglones(id) on delete cascade,
  proveedor    text,
  grupo        text,           -- "Sin compre neuquino" / "Con compre neuquino"
  estado       text,           -- Cotizó | No cotiza | Desestimada s/marca | ...
  precio_total numeric,
  marca        text,
  es_propio    boolean default false,
  adjudicado   boolean         -- solo si se sabe (histórico)
);
create index if not exists cc_ofer_ren_idx on cc_comp_ofertas(renglon_id);

-- ---------- Configuración compartida ----------
create table if not exists cc_config (
  clave text primary key,
  valor jsonb
);

-- ---------- updated_at automático ----------
create or replace function cc_touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists cc_cot_touch on cc_cotizaciones;
create trigger cc_cot_touch before update on cc_cotizaciones for each row execute function cc_touch();
drop trigger if exists cc_items_touch on cc_items;
create trigger cc_items_touch before update on cc_items for each row execute function cc_touch();

-- ---------- Seguridad: solo usuarios logueados ----------
do $$
declare t text;
begin
  foreach t in array array['cc_cotizaciones','cc_items','cc_costos','cc_cargas_costos',
                           'cc_comparativas','cc_comp_renglones','cc_comp_ofertas','cc_config']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t||'_auth', t);
    execute format('create policy %I on %I for all to authenticated using (true) with check (true)', t||'_auth', t);
  end loop;
end $$;
