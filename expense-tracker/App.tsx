import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  Budgets,
  CATEGORIES,
  Expense,
  LEVEL_COLOR,
  budgetLevel,
  categoryById,
  formatDay,
  formatMoney,
  loadBudgets,
  loadExpenses,
  monthCategoryTotal,
  monthLabel,
  sameMonth,
  saveBudgets,
  saveExpenses,
} from './src/data';

type Tab = 'summary' | 'add' | 'budget';

export default function App() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [budgets, setBudgets] = useState<Budgets>({});
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<Tab>('summary');

  useEffect(() => {
    Promise.all([loadExpenses(), loadBudgets()]).then(([e, b]) => {
      setExpenses(e);
      setBudgets(b);
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (loaded) saveExpenses(expenses);
  }, [expenses, loaded]);

  useEffect(() => {
    if (loaded) saveBudgets(budgets);
  }, [budgets, loaded]);

  const addExpense = (e: Omit<Expense, 'id'>) => {
    setExpenses((prev) => [{ ...e, id: Date.now().toString() }, ...prev]);
    setTab('summary');
    warnIfOverBudget(e);
  };

  const warnIfOverBudget = (e: Omit<Expense, 'id'>) => {
    const budget = budgets[e.categoryId];
    if (!budget) return;
    const d = new Date(e.date);
    const before = monthCategoryTotal(expenses, e.categoryId, d.getFullYear(), d.getMonth());
    const after = before + e.amount;
    const cat = categoryById(e.categoryId);
    const levelBefore = budgetLevel(before, budget);
    const levelAfter = budgetLevel(after, budget);
    if (levelAfter === 'over') {
      Alert.alert(
        `🚨 חרגת מהתקציב: ${cat.name}`,
        `הוצאת החודש ${formatMoney(after)} מתוך ${formatMoney(budget)} (חריגה של ${formatMoney(after - budget)}).`,
      );
    } else if (levelAfter === 'warn' && levelBefore === 'ok') {
      Alert.alert(
        `⚠️ מתקרב לגבול: ${cat.name}`,
        `ניצלת ${Math.round((after / budget) * 100)}% מהתקציב. נשארו ${formatMoney(budget - after)} עד סוף החודש.`,
      );
    }
  };

  const deleteExpense = (id: string) => {
    Alert.alert('מחיקת הוצאה', 'למחוק את ההוצאה הזו?', [
      { text: 'ביטול', style: 'cancel' },
      { text: 'מחק', style: 'destructive', onPress: () => setExpenses((p) => p.filter((x) => x.id !== id)) },
    ]);
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <StatusBar style="dark" />
        <View style={styles.content}>
          {tab === 'summary' && <SummaryScreen expenses={expenses} budgets={budgets} onDelete={deleteExpense} />}
          {tab === 'add' && <AddScreen onSave={addExpense} />}
          {tab === 'budget' && (
            <BudgetScreen
              budgets={budgets}
              expenses={expenses}
              onSave={(b) => {
                setBudgets(b);
                setTab('summary');
              }}
            />
          )}
        </View>
        <View style={styles.tabBar}>
          <TabButton label="📊 סיכום" active={tab === 'summary'} onPress={() => setTab('summary')} />
          <TabButton label="➕ הוספה" active={tab === 'add'} onPress={() => setTab('add')} />
          <TabButton label="🎯 תקציב" active={tab === 'budget'} onPress={() => setTab('budget')} />
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.tabBtn, active && styles.tabBtnActive]} onPress={onPress}>
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </Pressable>
  );
}

function SummaryScreen({
  expenses,
  budgets,
  onDelete,
}: {
  expenses: Expense[];
  budgets: Budgets;
  onDelete: (id: string) => void;
}) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  const shiftMonth = (delta: number) => {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  };

  const monthly = useMemo(() => expenses.filter((e) => sameMonth(e.date, year, month)), [expenses, year, month]);

  const total = monthly.reduce((s, e) => s + e.amount, 0);
  const totalBudget = Object.values(budgets).reduce((s, b) => s + b, 0);

  // Categories with spending or with a budget, so an unused budget still shows up.
  const byCategory = useMemo(() => {
    const sums = new Map<string, number>();
    Object.keys(budgets).forEach((id) => sums.set(id, 0));
    monthly.forEach((e) => sums.set(e.categoryId, (sums.get(e.categoryId) ?? 0) + e.amount));
    return [...sums.entries()]
      .map(([id, sum]) => ({ cat: categoryById(id), sum, budget: budgets[id] as number | undefined }))
      .sort((a, b) => b.sum - a.sum);
  }, [monthly, budgets]);

  return (
    <FlatList
      data={monthly}
      keyExtractor={(e) => e.id}
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      ListHeaderComponent={
        <View>
          <View style={styles.monthNav}>
            <Pressable onPress={() => shiftMonth(1)} hitSlop={12}>
              <Text style={styles.arrow}>‹</Text>
            </Pressable>
            <Text style={styles.monthTitle}>{monthLabel(year, month)}</Text>
            <Pressable onPress={() => shiftMonth(-1)} hitSlop={12}>
              <Text style={styles.arrow}>›</Text>
            </Pressable>
          </View>

          <View style={styles.totalCard}>
            <Text style={styles.totalLabel}>סה״כ הוצאות החודש</Text>
            <Text style={styles.totalValue}>{formatMoney(total)}</Text>
            {totalBudget > 0 && (
              <Text style={styles.totalSub}>
                {total <= totalBudget
                  ? `נשארו ${formatMoney(totalBudget - total)} מתוך תקציב של ${formatMoney(totalBudget)}`
                  : `חריגה של ${formatMoney(total - totalBudget)} מתקציב של ${formatMoney(totalBudget)}`}
              </Text>
            )}
          </View>

          {byCategory.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>לפי קטגוריה</Text>
              {byCategory.map(({ cat, sum, budget }) => {
                // With a budget the bar shows budget usage, otherwise share of the month's total.
                const level = budget ? budgetLevel(sum, budget) : null;
                const ratio = budget ? sum / budget : total ? sum / total : 0;
                return (
                  <View key={cat.id} style={{ marginBottom: 12 }}>
                    <View style={styles.rowBetween}>
                      <Text style={styles.text}>
                        {cat.emoji} {cat.name}
                        {level === 'warn' ? '  ⚠️' : level === 'over' ? '  🚨' : ''}
                      </Text>
                      <Text style={[styles.textBold, level && level !== 'ok' && { color: LEVEL_COLOR[level] }]}>
                        {formatMoney(sum)}
                        {budget ? <Text style={styles.subText}> / {formatMoney(budget)}</Text> : null}
                      </Text>
                    </View>
                    <View style={styles.barTrack}>
                      <View
                        style={[
                          styles.barFill,
                          {
                            width: `${Math.min(ratio, 1) * 100}%`,
                            backgroundColor: level ? LEVEL_COLOR[level] : cat.color,
                          },
                        ]}
                      />
                    </View>
                    {budget ? (
                      <Text style={[styles.subText, level !== 'ok' && { color: LEVEL_COLOR[level!] }]}>
                        {sum <= budget
                          ? `נשארו ${formatMoney(budget - sum)}`
                          : `חריגה של ${formatMoney(sum - budget)}`}
                      </Text>
                    ) : null}
                  </View>
                );
              })}
            </View>
          )}

          <Text style={[styles.sectionTitle, { marginTop: 8 }]}>
            {monthly.length ? 'כל ההוצאות (לחיצה ארוכה למחיקה)' : ''}
          </Text>
        </View>
      }
      ListEmptyComponent={
        <Text style={styles.empty}>אין עדיין הוצאות בחודש הזה.{'\n'}לחץ על ״הוצאה חדשה״ כדי להתחיל.</Text>
      }
      renderItem={({ item }) => {
        const cat = categoryById(item.categoryId);
        return (
          <Pressable onLongPress={() => onDelete(item.id)} style={styles.expenseRow}>
            <View style={[styles.emojiBubble, { backgroundColor: cat.color + '22' }]}>
              <Text style={{ fontSize: 20 }}>{cat.emoji}</Text>
            </View>
            <View style={{ flex: 1, marginHorizontal: 12 }}>
              <Text style={styles.textBold}>{item.note || cat.name}</Text>
              <Text style={styles.subText}>
                {cat.name} · {formatDay(item.date)}
              </Text>
            </View>
            <Text style={styles.textBold}>{formatMoney(item.amount)}</Text>
          </Pressable>
        );
      }}
    />
  );
}

function AddScreen({ onSave }: { onSave: (e: Omit<Expense, 'id'>) => void }) {
  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState(CATEGORIES[0].id);
  const [note, setNote] = useState('');

  const save = () => {
    const value = parseFloat(amount.replace(',', '.'));
    if (!value || value <= 0) {
      Alert.alert('סכום לא תקין', 'נא להזין סכום גדול מאפס');
      return;
    }
    onSave({ amount: value, categoryId, note: note.trim(), date: new Date().toISOString() });
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
        <Text style={styles.sectionTitle}>כמה הוצאת?</Text>
        <View style={styles.amountBox}>
          <Text style={styles.currency}>₪</Text>
          <TextInput
            style={styles.amountInput}
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor="#B8C2CC"
            autoFocus
          />
        </View>

        <Text style={styles.sectionTitle}>קטגוריה</Text>
        <View style={styles.grid}>
          {CATEGORIES.map((c) => {
            const selected = c.id === categoryId;
            return (
              <Pressable
                key={c.id}
                onPress={() => setCategoryId(c.id)}
                style={[styles.catChip, selected && { borderColor: c.color, backgroundColor: c.color + '1A' }]}
              >
                <Text style={{ fontSize: 24 }}>{c.emoji}</Text>
                <Text style={[styles.catName, selected && { color: c.color, fontWeight: '700' }]}>{c.name}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.sectionTitle}>הערה (לא חובה)</Text>
        <TextInput
          style={styles.noteInput}
          value={note}
          onChangeText={setNote}
          placeholder="למשל: סופר שבועי"
          placeholderTextColor="#B8C2CC"
        />

        <Pressable style={styles.saveBtn} onPress={save}>
          <Text style={styles.saveText}>שמירה</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function BudgetScreen({
  budgets,
  expenses,
  onSave,
}: {
  budgets: Budgets;
  expenses: Expense[];
  onSave: (b: Budgets) => void;
}) {
  const now = new Date();
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(CATEGORIES.map((c) => [c.id, budgets[c.id] ? String(budgets[c.id]) : ''])),
  );

  const save = () => {
    const next: Budgets = {};
    for (const [id, text] of Object.entries(draft)) {
      const value = parseFloat(text.replace(',', '.'));
      if (value > 0) next[id] = value;
    }
    onSave(next);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
        <Text style={styles.sectionTitle}>תקציב חודשי לכל קטגוריה</Text>
        <Text style={[styles.subText, { marginBottom: 16 }]}>
          השאר ריק לקטגוריה בלי תקציב. תקבל התראה כשתגיע ל-80% וכשתחרוג.
        </Text>
        {CATEGORIES.map((c) => {
          const spent = monthCategoryTotal(expenses, c.id, now.getFullYear(), now.getMonth());
          return (
            <View key={c.id} style={styles.budgetRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.textBold}>
                  {c.emoji} {c.name}
                </Text>
                <Text style={styles.subText}>החודש: {formatMoney(spent)}</Text>
              </View>
              <View style={styles.budgetInputBox}>
                <Text style={styles.subText}>₪</Text>
                <TextInput
                  style={styles.budgetInput}
                  value={draft[c.id]}
                  onChangeText={(t) => setDraft((d) => ({ ...d, [c.id]: t }))}
                  keyboardType="decimal-pad"
                  placeholder="ללא"
                  placeholderTextColor="#B8C2CC"
                />
              </View>
            </View>
          );
        })}
        <Pressable style={[styles.saveBtn, { marginTop: 12 }]} onPress={save}>
          <Text style={styles.saveText}>שמירת תקציב</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F4F6FA' },
  content: { flex: 1 },
  tabBar: {
    flexDirection: 'row-reverse',
    padding: 8,
    gap: 8,
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#D9E0E8',
  },
  tabBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  tabBtnActive: { backgroundColor: '#1F6FEB' },
  tabText: { fontSize: 16, color: '#52606D', fontWeight: '600' },
  tabTextActive: { color: '#fff' },

  monthNav: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  arrow: { fontSize: 32, color: '#1F6FEB', paddingHorizontal: 8 },
  monthTitle: { fontSize: 20, fontWeight: '700', color: '#1F2933' },

  totalCard: { backgroundColor: '#1F6FEB', borderRadius: 16, padding: 20, marginBottom: 16, alignItems: 'flex-end' },
  totalLabel: { color: '#DCE8FF', fontSize: 14 },
  totalValue: { color: '#fff', fontSize: 34, fontWeight: '800', marginTop: 4 },
  totalSub: { color: '#DCE8FF', fontSize: 14, marginTop: 6 },

  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#1F2933', marginBottom: 10, textAlign: 'right' },
  rowBetween: { flexDirection: 'row-reverse', justifyContent: 'space-between', marginBottom: 4 },
  text: { fontSize: 15, color: '#1F2933', textAlign: 'right' },
  textBold: { fontSize: 15, color: '#1F2933', fontWeight: '700', textAlign: 'right' },
  subText: { fontSize: 13, color: '#7B8794', textAlign: 'right', marginTop: 2 },
  barTrack: { height: 8, backgroundColor: '#EEF2F6', borderRadius: 4, overflow: 'hidden', flexDirection: 'row-reverse' },
  barFill: { height: 8, borderRadius: 4 },

  expenseRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 14,
    marginBottom: 8,
  },
  emojiBubble: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  empty: { textAlign: 'center', color: '#7B8794', marginTop: 24, fontSize: 15, lineHeight: 22 },

  amountBox: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingHorizontal: 16,
    marginBottom: 20,
  },
  currency: { fontSize: 32, color: '#7B8794', marginLeft: 8 },
  amountInput: { flex: 1, fontSize: 40, fontWeight: '800', color: '#1F2933', paddingVertical: 14, textAlign: 'right' },

  grid: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  catChip: {
    width: '30.5%',
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  catName: { fontSize: 13, color: '#52606D', marginTop: 4 },

  noteInput: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    fontSize: 16,
    textAlign: 'right',
    color: '#1F2933',
    marginBottom: 24,
  },
  saveBtn: { backgroundColor: '#1F6FEB', borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  budgetRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
    gap: 12,
  },
  budgetInputBox: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    backgroundColor: '#F4F6FA',
    borderRadius: 10,
    paddingHorizontal: 10,
    width: 120,
  },
  budgetInput: { flex: 1, fontSize: 17, fontWeight: '700', color: '#1F2933', paddingVertical: 8, textAlign: 'right' },
  saveText: { color: '#fff', fontSize: 18, fontWeight: '700' },
});
