-- Run this in the Supabase SQL editor (Project > SQL Editor > New query).
-- Storage: also create a PUBLIC bucket named "og-images" in Storage.

create table if not exists public.links (
  id          bigint generated always as identity primary key,
  code        text unique not null,
  target_url  text not null,
  title       text default '',
  description text default '',
  image_url   text,
  clicks      int  default 0,
  owner       text,
  created_at  timestamptz default now()
);

-- Already have the table from before? Run just these two lines instead:
--   alter table public.links add column if not exists owner text;
--   create index if not exists links_owner_idx on public.links (owner);

create index if not exists links_created_at_idx on public.links (created_at desc);
create index if not exists links_owner_idx on public.links (owner);

-- Atomic click increment (avoids read-then-write races).
create or replace function public.bump_clicks(p_code text)
returns void language sql as $$
  update public.links set clicks = clicks + 1 where code = p_code;
$$;
