-- Run this in your Supabase SQL editor
-- supabase.com → Project → SQL Editor

create table if not exists zeno_data (
  user_id text primary key,
  data jsonb not null,
  updated_at timestamptz default now()
);

-- Enable Row Level Security
alter table zeno_data enable row level security;

-- Allow anyone with the anon key to read/write their own data
create policy "Users can manage their own data"
  on zeno_data for all
  using (true)
  with check (true);
