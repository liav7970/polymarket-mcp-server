-- Cashio database schema. Run once in Supabase: SQL Editor → New query → paste → Run.

create table if not exists public.expenses (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  amount numeric(12, 2) not null check (amount > 0),
  category_id text not null,
  note text not null default '' check (char_length(note) <= 500),
  date timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists expenses_user_date_idx on public.expenses (user_id, date desc);

create table if not exists public.budgets (
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  category_id text not null,
  amount numeric(12, 2) not null check (amount > 0),
  primary key (user_id, category_id)
);

-- Row-level security: every user can see and change only their own rows.
alter table public.expenses enable row level security;
alter table public.budgets enable row level security;

drop policy if exists "own expenses" on public.expenses;
create policy "own expenses" on public.expenses
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "own budgets" on public.budgets;
create policy "own budgets" on public.budgets
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Lets a signed-in user delete their own account (and, by cascade, all their data).
create or replace function public.delete_my_account()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from auth.users where id = auth.uid();
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
