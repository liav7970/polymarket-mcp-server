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

export const formatDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getDate()}/${d.getMonth() + 1}`;
};
