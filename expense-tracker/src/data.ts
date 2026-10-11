import AsyncStorage from '@react-native-async-storage/async-storage';

export type Expense = {
  id: string;
  amount: number;
  categoryId: string;
  note: string;
  date: string; // ISO
};

export type Category = { id: string; name: string; emoji: string; color: string };

export const CATEGORIES: Category[] = [
  { id: 'food', name: 'אוכל', emoji: '🛒', color: '#E8833A' },
  { id: 'eating-out', name: 'מסעדות', emoji: '🍔', color: '#D9534F' },
  { id: 'transport', name: 'תחבורה', emoji: '🚗', color: '#3A7BD5' },
  { id: 'home', name: 'בית', emoji: '🏠', color: '#6C5CE7' },
  { id: 'bills', name: 'חשבונות', emoji: '💡', color: '#F0B429' },
  { id: 'health', name: 'בריאות', emoji: '💊', color: '#2BB673' },
  { id: 'fun', name: 'בילויים', emoji: '🎉', color: '#E84393' },
  { id: 'shopping', name: 'קניות', emoji: '🛍️', color: '#00A8A8' },
  { id: 'other', name: 'אחר', emoji: '📦', color: '#8395A7' },
];

export const categoryById = (id: string) =>
  CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[CATEGORIES.length - 1];

const KEY = 'expenses:v1';

export async function loadExpenses(): Promise<Expense[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Expense[]) : [];
  } catch {
    return [];
  }
}

export async function saveExpenses(expenses: Expense[]) {
  await AsyncStorage.setItem(KEY, JSON.stringify(expenses));
}

export const formatMoney = (n: number) =>
  '₪' + n.toLocaleString('he-IL', { maximumFractionDigits: 2 });

const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

export const monthLabel = (year: number, month: number) => `${MONTHS[month]} ${year}`;

const MONTHS_SHORT = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳'];

export const monthShort = (month: number) => MONTHS_SHORT[month];

const WEEKDAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

export const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export const formatFullDay = (d: Date) => {
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const prefix = isSameDay(d, today) ? 'היום, ' : isSameDay(d, yesterday) ? 'אתמול, ' : '';
  return `${prefix}יום ${WEEKDAYS[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
};

export const formatDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getDate()}/${d.getMonth() + 1}`;
};

// Monthly budget per category, same amount every month. Missing key = no budget.
export type Budgets = Record<string, number>;

const BUDGETS_KEY = 'budgets:v1';

export async function loadBudgets(): Promise<Budgets> {
  try {
    const raw = await AsyncStorage.getItem(BUDGETS_KEY);
    return raw ? (JSON.parse(raw) as Budgets) : {};
  } catch {
    return {};
  }
}

export async function saveBudgets(budgets: Budgets) {
  await AsyncStorage.setItem(BUDGETS_KEY, JSON.stringify(budgets));
}

export const WARN_RATIO = 0.8;

export type BudgetLevel = 'ok' | 'warn' | 'over';

export const budgetLevel = (spent: number, budget: number): BudgetLevel =>
  spent > budget ? 'over' : spent >= budget * WARN_RATIO ? 'warn' : 'ok';

export const LEVEL_COLOR: Record<BudgetLevel, string> = { ok: '#2BB673', warn: '#F08C00', over: '#D9534F' };

export const sameMonth = (iso: string, year: number, month: number) => {
  const d = new Date(iso);
  return d.getFullYear() === year && d.getMonth() === month;
};

export const monthCategoryTotal = (expenses: Expense[], categoryId: string, year: number, month: number) =>
  expenses
    .filter((e) => e.categoryId === categoryId && sameMonth(e.date, year, month))
    .reduce((s, e) => s + e.amount, 0);
