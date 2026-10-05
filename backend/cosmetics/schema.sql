-- Additive migration; run only against the existing isolated Minecraft database.
begin;
create table if not exists public.bloom_cape_revisions (
  id uuid primary key, cape_id uuid not null, name text not null check (length(name) between 1 and 64),
  owner_uuid text not null check (owner_uuid ~ '^[a-f0-9]{32}$'),
  texture_path text not null, texture_sha256 text not null, width integer not null, height integer not null,
  elytra_path text, elytra_sha256 text, elytra_width integer, elytra_height integer,
  atlas_path text, animation jsonb, created_at timestamptz not null default now()
);
alter table public.bloom_cape_revisions add column if not exists elytra_path text;
alter table public.bloom_cape_revisions add column if not exists elytra_sha256 text;
alter table public.bloom_cape_revisions add column if not exists elytra_width integer;
alter table public.bloom_cape_revisions add column if not exists elytra_height integer;
create table if not exists public.bloom_capes (
  id uuid primary key, name text not null, current_revision uuid not null references public.bloom_cape_revisions(id),
  published boolean not null default false
);
create table if not exists public.bloom_cape_players (
  uuid text primary key check (uuid ~ '^[a-f0-9]{32}$'),
  cape_id uuid references public.bloom_capes(id), badge_visible boolean not null default true
);
create table if not exists public.bloom_cape_sessions (
  token_hash text primary key, uuid text not null check (uuid ~ '^[a-f0-9]{32}$'),
  last_seen timestamptz not null, expires_at timestamptz not null
);
create index if not exists bloom_cape_sessions_presence on public.bloom_cape_sessions(uuid, last_seen);
alter table public.bloom_cape_revisions enable row level security;
alter table public.bloom_capes enable row level security;
alter table public.bloom_cape_players enable row level security;
alter table public.bloom_cape_sessions enable row level security;
revoke all on public.bloom_cape_revisions, public.bloom_capes, public.bloom_cape_players, public.bloom_cape_sessions from anon, authenticated;
grant all on public.bloom_cape_revisions, public.bloom_capes, public.bloom_cape_players, public.bloom_cape_sessions to service_role;

create or replace function public.bloom_publish_cape(p_id uuid, p_revision uuid, p_owner text) returns void
language plpgsql set search_path = public as $$
declare revision bloom_cape_revisions;
begin
  select * into revision from bloom_cape_revisions where id=p_revision and cape_id=p_id and owner_uuid=p_owner;
  if not found then raise exception 'revision_not_found'; end if;
  insert into bloom_capes(id,name,current_revision,published) values(p_id,revision.name,p_revision,true)
    on conflict(id) do update set name=excluded.name,current_revision=excluded.current_revision,published=true;
end $$;
create or replace function public.bloom_equip_cape(p_uuid text, p_cape uuid) returns void
language plpgsql set search_path = public as $$
begin
  if p_cape is not null and not exists(select 1 from bloom_capes where id=p_cape and published) then raise exception 'cape_unavailable'; end if;
  insert into bloom_cape_players(uuid,cape_id) values(p_uuid,p_cape) on conflict(uuid) do update set cape_id=excluded.cape_id;
end $$;
create or replace function public.bloom_set_badge(p_uuid text, p_visible boolean) returns void
language plpgsql set search_path = public as $$
begin
  insert into bloom_cape_players(uuid,badge_visible) values(p_uuid,p_visible) on conflict(uuid) do update set badge_visible=excluded.badge_visible;
end $$;
revoke all on function public.bloom_publish_cape(uuid,uuid,text), public.bloom_equip_cape(text,uuid), public.bloom_set_badge(text,boolean) from public, anon, authenticated;
grant execute on function public.bloom_publish_cape(uuid,uuid,text), public.bloom_equip_cape(text,uuid), public.bloom_set_badge(text,boolean) to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('bloom-capes','bloom-capes',false,33554432,array['image/png']) on conflict(id) do nothing;
commit;
