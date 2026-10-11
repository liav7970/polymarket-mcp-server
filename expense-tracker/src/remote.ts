import { Budgets, Expense } from './data';
import { supabase } from './supabase';

type ExpenseRow = { id: string; amount: number; category_id: string; note: string; date: string };

const toExpense = (r: ExpenseRow): Expense => ({
  id: r.id,
  amount: Number(r.amount),
  categoryId: r.category_id,
  note: r.note,
  date: r.date,
});

const toRow = (e: Expense, userId: string) => ({
  id: e.id,
  user_id: userId,
  amount: e.amount,
  category_id: e.categoryId,
  note: e.note,
  date: e.date,
});

// Supabase returns { error } instead of throwing; turn it into an exception for callers.
function check<T>({ data, error }: { data: T; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data;
}

export async function fetchAll(): Promise<{ expenses: Expense[]; budgets: Budgets }> {
  const [exp, bud] = await Promise.all([
    supabase.from('expenses').select('id, amount, category_id, note, date').order('date', { ascending: false }),
    supabase.from('budgets').select('category_id, amount'),
  ]);
  const expenses = (check(exp) as ExpenseRow[]).map(toExpense);
  const budgets: Budgets = {};
  for (const b of check(bud) as { category_id: string; amount: number }[]) budgets[b.category_id] = Number(b.amount);
  return { expenses, budgets };
}

export async function upsertExpense(e: Expense, userId: string) {
  check(await supabase.from('expenses').upsert(toRow(e, userId)));
}

export async function deleteExpenseRemote(id: string) {
  check(await supabase.from('expenses').delete().eq('id', id));
}

export async function replaceBudgets(budgets: Budgets, userId: string) {
  check(await supabase.from('budgets').delete().eq('user_id', userId));
  const rows = Object.entries(budgets).map(([category_id, amount]) => ({ user_id: userId, category_id, amount }));
  if (rows.length) check(await supabase.from('budgets').insert(rows));
}

export async function deleteAllData(userId: string) {
  check(await supabase.from('expenses').delete().eq('user_id', userId));
  check(await supabase.from('budgets').delete().eq('user_id', userId));
}

// Deletes the auth user; expenses and budgets go with it (ON DELETE CASCADE).
export async function deleteAccount() {
  check(await supabase.rpc('delete_my_account'));
  await supabase.auth.signOut();
}

// Random v4 UUID. Hermes has no crypto.randomUUID; these ids only need to be unique, not secret.
export function newId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
