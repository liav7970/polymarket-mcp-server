import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { A11yButton, A11yProvider, Text, TextInput } from './src/a11y';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  Budgets,
  CATEGORIES,
  Expense,
  LEVEL_COLOR,
  LEVEL_TEXT,
  budgetLevel,
  categoryById,
  formatDay,
  formatFullDay,
  isSameDay,
  formatMoney,
  loadBudgets,
  loadExpenses,
  monthCategoryTotal,
  monthLabel,
  monthShort,
  sameMonth,
  saveBudgets,
  saveExpenses,
  clearLocalCache,
} from './src/data';
import type { Session } from '@supabase/supabase-js';
import { AuthScreen, NewPasswordScreen, NotConfiguredScreen } from './src/AuthScreens';
import { confirmDestructive, notify } from './src/dialogs';
import { APP_NAME, LEGAL_DOCS, LegalDoc, OPERATOR } from './src/legal';
import { LegalDocView } from './src/LegalDocView';
import {
  deleteAccount,
  deleteAllData,
  deleteExpenseRemote,
  fetchAll,
  newId,
  replaceBudgets,
  upsertExpense,
} from './src/remote';
import { isSupabaseConfigured, supabase } from './src/supabase';

type Tab = 'summary' | 'add' | 'budget' | 'info';

export default function App() {
  // undefined = still checking for a saved session.
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  let content;
  if (!isSupabaseConfigured) content = <NotConfiguredScreen />;
  else if (session === undefined) content = <ActivityIndicator style={{ flex: 1 }} color="#1A5FD0" />;
  else if (recovering && session) content = <NewPasswordScreen onDone={() => setRecovering(false)} />;
  else if (!session) content = <AuthScreen />;
  else content = <MainApp key={session.user.id} userId={session.user.id} email={session.user.email ?? ''} />;

  // Inside the app the button sits above the tab bar (rendered by MainApp); elsewhere, here.
  const hasTabBar = Boolean(isSupabaseConfigured && session && !recovering);

  return (
    <A11yProvider>
      <SafeAreaProvider>
        <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
          <StatusBar style="dark" />
          {content}
          {!hasTabBar && <A11yButton style={{ bottom: 16 }} />}
        </SafeAreaView>
      </SafeAreaProvider>
    </A11yProvider>
  );
}

function MainApp({ userId, email }: { userId: string; email: string }) {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [budgets, setBudgets] = useState<Budgets>({});
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<Tab>('summary');
  const [editing, setEditing] = useState<Expense | null>(null);

  const goTo = (t: Tab) => {
    setEditing(null);
    setTab(t);
  };

  // Show the local cache right away, then replace it with what the server has.
  const refresh = () =>
    fetchAll()
      .then(({ expenses: e, budgets: b }) => {
        setExpenses(e);
        setBudgets(b);
      })
      .catch(() => {
        // Offline: keep showing the cached data.
      });

  useEffect(() => {
    Promise.all([loadExpenses(userId), loadBudgets(userId)]).then(([e, b]) => {
      setExpenses(e);
      setBudgets(b);
      setLoaded(true);
      refresh();
    });
  }, [userId]);

  useEffect(() => {
    if (loaded) saveExpenses(userId, expenses);
  }, [expenses, loaded, userId]);

  useEffect(() => {
    if (loaded) saveBudgets(userId, budgets);
  }, [budgets, loaded, userId]);

  // Changes are applied on screen immediately and sent to the server; if sending fails,
  // tell the user and reload from the server so the screen matches what is really saved.
  const sync = (op: Promise<unknown>) =>
    op.catch(() => {
      notify('השינוי לא נשמר', 'אין חיבור לשרת. בדוק את החיבור לאינטרנט ונסה שוב.');
      refresh();
    });

  const saveExpense = (e: Omit<Expense, 'id'>) => {
    const editedId = editing?.id;
    const saved: Expense = { ...e, id: editedId ?? newId() };
    if (editedId) {
      setExpenses((prev) => prev.map((x) => (x.id === editedId ? saved : x)));
    } else {
      setExpenses((prev) => [saved, ...prev]);
    }
    sync(upsertExpense(saved, userId));
    goTo('summary');
    warnIfOverBudget(e, editedId);
  };

  // excludeId: when editing, the expense's old version must not count toward "before".
  const warnIfOverBudget = (e: Omit<Expense, 'id'>, excludeId?: string) => {
    const budget = budgets[e.categoryId];
    if (!budget) return;
    const d = new Date(e.date);
    const others = excludeId ? expenses.filter((x) => x.id !== excludeId) : expenses;
    const before = monthCategoryTotal(others, e.categoryId, d.getFullYear(), d.getMonth());
    const after = before + e.amount;
    const cat = categoryById(e.categoryId);
    const levelBefore = budgetLevel(before, budget);
    const levelAfter = budgetLevel(after, budget);
    if (levelAfter === 'over') {
      notify(
        `🚨 חרגת מהתקציב: ${cat.name}`,
        `הוצאת החודש ${formatMoney(after)} מתוך ${formatMoney(budget)} (חריגה של ${formatMoney(after - budget)}).`,
      );
    } else if (levelAfter === 'warn' && levelBefore === 'ok') {
      notify(
        `⚠️ מתקרב לגבול: ${cat.name}`,
        `ניצלת ${Math.round((after / budget) * 100)}% מהתקציב. נשארו ${formatMoney(budget - after)} עד סוף החודש.`,
      );
    }
  };

  const deleteExpense = (id: string) => {
    confirmDestructive('מחיקת הוצאה', 'למחוק את ההוצאה הזו?', 'מחק', () => {
      setExpenses((p) => p.filter((x) => x.id !== id));
      sync(deleteExpenseRemote(id));
      if (editing?.id === id) goTo('summary');
    });
  };

  const startEdit = (e: Expense) => {
    setEditing(e);
    setTab('add');
  };

  return (
    <>
      <View style={styles.content}>
        {tab === 'summary' && (
          <SummaryScreen expenses={expenses} budgets={budgets} onEdit={startEdit} onDelete={deleteExpense} />
        )}
        {tab === 'add' && (
          <AddScreen
            key={editing?.id ?? 'new'}
            initial={editing}
            onSave={saveExpense}
            onDelete={editing ? () => deleteExpense(editing.id) : undefined}
            onCancel={editing ? () => goTo('summary') : undefined}
          />
        )}
        {tab === 'budget' && (
          <BudgetScreen
            budgets={budgets}
            expenses={expenses}
            onSave={(b) => {
              setBudgets(b);
              sync(replaceBudgets(b, userId));
              goTo('summary');
            }}
          />
        )}
        {tab === 'info' && (
          <InfoScreen
            email={email}
            onSignOut={() =>
              confirmDestructive('התנתקות', 'להתנתק מהחשבון במכשיר הזה?', 'התנתק', async () => {
                await clearLocalCache(userId);
                await supabase.auth.signOut({ scope: 'local' });
              })
            }
            onDeleteAll={() =>
              confirmDestructive(
                'מחיקת כל הנתונים',
                'כל ההוצאות והתקציבים יימחקו מהחשבון לצמיתות. לא ניתן לשחזר אותם. החשבון עצמו יישאר.',
                'מחק הכול',
                () => {
                  setExpenses([]);
                  setBudgets({});
                  sync(deleteAllData(userId));
                  goTo('summary');
                },
              )
            }
            onDeleteAccount={() =>
              confirmDestructive(
                'מחיקת החשבון',
                'החשבון וכל הנתונים שבו יימחקו לצמיתות, כולל ההוצאות והתקציבים. לא ניתן לשחזר אותם.',
                'מחק את החשבון',
                () =>
                  deleteAccount()
                    .then(() => clearLocalCache(userId))
                    .catch(() => notify('המחיקה נכשלה', 'אין חיבור לשרת. נסה שוב מאוחר יותר.')),
              )
            }
          />
        )}
      </View>
      <View style={styles.tabBar}>
        <A11yButton style={{ bottom: '100%', marginBottom: 12 }} />
        <TabButton label="📊 סיכום" active={tab === 'summary'} onPress={() => goTo('summary')} />
        <TabButton label={editing ? '✏️ עריכה' : '➕ הוספה'} active={tab === 'add'} onPress={() => goTo('add')} />
        <TabButton label="🎯 תקציב" active={tab === 'budget'} onPress={() => goTo('budget')} />
        <TabButton label="ℹ️ מידע" active={tab === 'info'} onPress={() => goTo('info')} />
      </View>
    </>
  );
}

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      style={[styles.tabBtn, active && styles.tabBtnActive]}
      onPress={onPress}
    >
      {/* Icon above the word, so large text sizes still fit four tabs on one row. */}
      <Text style={styles.tabIcon} accessible={false}>
        {label.split(' ')[0]}
      </Text>
      <Text style={[styles.tabText, active && styles.tabTextActive]} numberOfLines={1}>
        {label.split(' ').slice(1).join(' ')}
      </Text>
    </Pressable>
  );
}

function SummaryScreen({
  expenses,
  budgets,
  onEdit,
  onDelete,
}: {
  expenses: Expense[];
  budgets: Budgets;
  onEdit: (e: Expense) => void;
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

  // Newest first by expense date, not by entry order (an expense can be backdated).
  const monthly = useMemo(
    () =>
      expenses
        .filter((e) => sameMonth(e.date, year, month))
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [expenses, year, month],
  );

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
            <Pressable
              accessibilityRole="button"
              onPress={() => shiftMonth(-1)}
              hitSlop={12}
              accessibilityLabel="חודש קודם"
            >
              <Text style={styles.arrow}>→</Text>
            </Pressable>
            <Text style={styles.monthTitle}>{monthLabel(year, month)}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => shiftMonth(1)}
              hitSlop={12}
              accessibilityLabel="חודש הבא"
            >
              <Text style={styles.arrow}>←</Text>
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

          <MonthlyTrend
            expenses={expenses}
            year={year}
            month={month}
            onSelect={(y, m) => {
              setYear(y);
              setMonth(m);
            }}
          />

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
                      <Text style={[styles.textBold, level && level !== 'ok' && { color: LEVEL_TEXT[level] }]}>
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
                      <Text style={[styles.subText, level !== 'ok' && { color: LEVEL_TEXT[level!] }]}>
                        {sum <= budget ? `נשארו ${formatMoney(budget - sum)}` : `חריגה של ${formatMoney(sum - budget)}`}
                      </Text>
                    ) : null}
                  </View>
                );
              })}
            </View>
          )}

          <Text style={[styles.sectionTitle, { marginTop: 8 }]}>{monthly.length ? 'כל ההוצאות' : ''}</Text>
          {monthly.length ? (
            <Text style={[styles.subText, { marginTop: -6, marginBottom: 10 }]}>לחיצה לעריכה · לחיצה ארוכה למחיקה</Text>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        <Text style={styles.empty}>אין עדיין הוצאות בחודש הזה.{'\n'}לחץ על ״הוצאה חדשה״ כדי להתחיל.</Text>
      }
      renderItem={({ item }) => {
        const cat = categoryById(item.categoryId);
        return (
          <Pressable
            accessibilityRole="button"
            onPress={() => onEdit(item)}
            onLongPress={() => onDelete(item.id)}
            style={styles.expenseRow}
          >
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

function AddScreen({
  initial,
  onSave,
  onDelete,
  onCancel,
}: {
  initial: Expense | null;
  onSave: (e: Omit<Expense, 'id'>) => void;
  onDelete?: () => void;
  onCancel?: () => void;
}) {
  const [amount, setAmount] = useState(initial ? String(initial.amount) : '');
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? CATEGORIES[0].id);
  const [note, setNote] = useState(initial?.note ?? '');
  const [date, setDate] = useState(() => (initial ? new Date(initial.date) : new Date()));

  const today = new Date();
  const isToday = isSameDay(date, today);

  // Keeps the time of day, only moves the calendar day. Future days are not allowed.
  const setDay = (base: Date, deltaDays: number) => {
    const d = new Date(date);
    d.setFullYear(base.getFullYear(), base.getMonth(), base.getDate() + deltaDays);
    if (d.getTime() > Date.now() && !isSameDay(d, today)) return;
    setDate(d);
  };

  const save = () => {
    const value = parseFloat(amount.replace(',', '.'));
    if (!value || value <= 0) {
      notify('סכום לא תקין', 'נא להזין סכום גדול מאפס');
      return;
    }
    onSave({ amount: value, categoryId, note: note.trim(), date: date.toISOString() });
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
            accessibilityLabel="סכום בשקלים"
            placeholder="0"
            placeholderTextColor="#6B7785"
            autoFocus={!initial}
          />
        </View>

        <Text style={styles.sectionTitle}>קטגוריה</Text>
        <View style={styles.grid}>
          {CATEGORIES.map((c) => {
            const selected = c.id === categoryId;
            return (
              <Pressable
                accessibilityRole="button"
                key={c.id}
                onPress={() => setCategoryId(c.id)}
                accessibilityState={{ selected }}
                accessibilityLabel={c.name}
                style={[styles.catChip, selected && { borderColor: c.color, backgroundColor: c.color + '1A' }]}
              >
                <Text style={{ fontSize: 24 }}>{c.emoji}</Text>
                <Text style={[styles.catName, selected && { color: '#1F2933', fontWeight: '700' }]}>{c.name}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.sectionTitle}>תאריך</Text>
        <View style={styles.dateBox}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setDay(date, -1)}
            hitSlop={10}
            accessibilityLabel="יום קודם"
          >
            <Text style={styles.arrow}>→</Text>
          </Pressable>
          <Text style={styles.dateText}>{formatFullDay(date)}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => setDay(date, 1)}
            hitSlop={10}
            disabled={isToday}
            accessibilityLabel="יום הבא"
            style={isToday && { opacity: 0.25 }}
          >
            <Text style={styles.arrow}>←</Text>
          </Pressable>
        </View>
        <View style={styles.quickDates}>
          {[
            { label: 'היום', delta: 0 },
            { label: 'אתמול', delta: -1 },
            { label: 'שלשום', delta: -2 },
          ].map(({ label, delta }) => {
            const selected = isSameDay(date, new Date(today.getFullYear(), today.getMonth(), today.getDate() + delta));
            return (
              <Pressable
                accessibilityRole="button"
                key={label}
                onPress={() => setDay(today, delta)}
                accessibilityState={{ selected }}
                style={[styles.quickChip, selected && styles.quickChipSelected]}
              >
                <Text style={[styles.quickChipText, selected && styles.quickChipTextSelected]}>{label}</Text>
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
          accessibilityLabel="הערה"
          placeholderTextColor="#6B7785"
        />

        <Pressable accessibilityRole="button" style={styles.saveBtn} onPress={save}>
          <Text style={styles.saveText}>{initial ? 'שמירת שינויים' : 'שמירה'}</Text>
        </Pressable>
        {onCancel && (
          <Pressable accessibilityRole="button" style={styles.secondaryBtn} onPress={onCancel}>
            <Text style={styles.secondaryText}>ביטול</Text>
          </Pressable>
        )}
        {onDelete && (
          <Pressable accessibilityRole="button" style={styles.secondaryBtn} onPress={onDelete}>
            <Text style={[styles.secondaryText, { color: '#D9534F' }]}>🗑 מחיקת ההוצאה</Text>
          </Pressable>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function InfoScreen({
  email,
  onSignOut,
  onDeleteAll,
  onDeleteAccount,
}: {
  email: string;
  onSignOut: () => void;
  onDeleteAll: () => void;
  onDeleteAccount: () => void;
}) {
  const [open, setOpen] = useState<LegalDoc | null>(null);

  if (open) return <LegalDocView doc={open} onBack={() => setOpen(null)} />;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
      <Text accessibilityRole="header" style={styles.docTitle}>
        {APP_NAME}
      </Text>

      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          החשבון שלי
        </Text>
        <Text style={styles.text}>{email}</Text>
        <Pressable accessibilityRole="button" style={styles.secondaryBtn} onPress={onSignOut}>
          <Text style={styles.secondaryText}>התנתקות</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        {LEGAL_DOCS.map((doc, i) => (
          <Pressable
            key={doc.id}
            accessibilityRole="button"
            onPress={() => setOpen(doc)}
            style={[styles.linkRow, i < LEGAL_DOCS.length - 1 && styles.linkRowBorder]}
          >
            <Text style={styles.text}>{doc.title}</Text>
            <Text style={[styles.text, { color: '#616E7C' }]}>‹</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          יצירת קשר
        </Text>
        <Text style={styles.text}>{OPERATOR.name}</Text>
        <Text style={styles.text}>{OPERATOR.email}</Text>
      </View>

      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          הנתונים שלי
        </Text>
        <Text style={[styles.docBody, { marginBottom: 8 }]}>
          הנתונים נשמרים בחשבון שלך ומסונכרנים בין המכשירים שבהם אתה מחובר.
        </Text>
        <Pressable accessibilityRole="button" style={styles.secondaryBtn} onPress={onDeleteAll}>
          <Text style={[styles.secondaryText, { color: '#C92A2A' }]}>🗑 מחיקת כל הנתונים</Text>
        </Pressable>
        <Pressable accessibilityRole="button" style={styles.secondaryBtn} onPress={onDeleteAccount}>
          <Text style={[styles.secondaryText, { color: '#C92A2A' }]}>מחיקת החשבון לצמיתות</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const TREND_MONTHS = 6;
const CHART_HEIGHT = 120;

// Bar chart of monthly totals. Oldest month on the right (RTL), the viewed month highlighted;
// tapping a bar switches the summary to that month.
function MonthlyTrend({
  expenses,
  year,
  month,
  onSelect,
}: {
  expenses: Expense[];
  year: number;
  month: number;
  onSelect: (year: number, month: number) => void;
}) {
  const now = new Date();
  const viewedIsOlder = year * 12 + month < now.getFullYear() * 12 + now.getMonth() - (TREND_MONTHS - 1);
  const end = viewedIsOlder
    ? new Date(year, month + TREND_MONTHS - 1, 1)
    : new Date(now.getFullYear(), now.getMonth(), 1);

  const bars = useMemo(() => {
    const out: { year: number; month: number; total: number }[] = [];
    for (let i = TREND_MONTHS - 1; i >= 0; i--) {
      const d = new Date(end.getFullYear(), end.getMonth() - i, 1);
      const y = d.getFullYear();
      const m = d.getMonth();
      const total = expenses.filter((e) => sameMonth(e.date, y, m)).reduce((s, e) => s + e.amount, 0);
      out.push({ year: y, month: m, total });
    }
    return out;
  }, [expenses, end.getFullYear(), end.getMonth()]);

  const max = Math.max(...bars.map((b) => b.total));
  if (max === 0) return null;

  const idx = bars.findIndex((b) => b.year === year && b.month === month);
  const current = bars[idx];
  const prev = idx > 0 ? bars[idx - 1] : undefined;
  // Average only over months that have spending, so a new user's empty months don't drag it down.
  const activeBars = bars.filter((b) => b.total > 0);
  const avg = activeBars.reduce((s, b) => s + b.total, 0) / activeBars.length;

  let comparison = '';
  if (current && prev && prev.total > 0) {
    const pct = Math.round(((current.total - prev.total) / prev.total) * 100);
    comparison =
      pct === 0
        ? `כמו ב${monthLabel(prev.year, prev.month).split(' ')[0]}`
        : `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}% ${pct > 0 ? 'יותר' : 'פחות'} מ${monthLabel(prev.year, prev.month).split(' ')[0]}`;
  }

  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>הוצאות ב-{TREND_MONTHS} חודשים</Text>
      {comparison ? <Text style={[styles.text, { marginBottom: 2 }]}>{comparison}</Text> : null}
      <Text style={[styles.subText, { marginBottom: 12 }]}>
        {activeBars.length > 1 ? `ממוצע חודשי: ${formatMoney(Math.round(avg))}` : ' '}
      </Text>

      <View style={styles.chartArea}>
        {bars.map((b) => {
          const selected = b.year === year && b.month === month;
          const h = (b.total / max) * CHART_HEIGHT;
          return (
            <Pressable
              accessibilityRole="button"
              key={`${b.year}-${b.month}`}
              style={styles.barCol}
              onPress={() => onSelect(b.year, b.month)}
              accessibilityLabel={`${monthLabel(b.year, b.month)}: ${formatMoney(b.total)}`}
            >
              <Text style={[styles.barValue, !selected && { opacity: 0 }]} numberOfLines={1}>
                {formatMoney(Math.round(b.total))}
              </Text>
              <View
                style={[
                  styles.trendBar,
                  { height: Math.max(h, b.total > 0 ? 3 : 0), backgroundColor: selected ? '#1A5FD0' : '#A9C4F5' },
                ]}
              />
            </Pressable>
          );
        })}
      </View>
      <View style={styles.chartBaseline} />
      <View style={styles.chartLabels}>
        {bars.map((b) => {
          const selected = b.year === year && b.month === month;
          return (
            <Pressable
              accessibilityRole="button"
              key={`${b.year}-${b.month}`}
              style={{ flex: 1 }}
              onPress={() => onSelect(b.year, b.month)}
            >
              <Text style={[styles.barLabel, selected && styles.barLabelSelected]}>{monthShort(b.month)}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
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
                  accessibilityLabel={`תקציב חודשי ל${c.name}`}
                  placeholderTextColor="#6B7785"
                />
              </View>
            </View>
          );
        })}
        <Pressable accessibilityRole="button" style={[styles.saveBtn, { marginTop: 12 }]} onPress={save}>
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
  tabBtn: { flex: 1, paddingVertical: 8, borderRadius: 12, alignItems: 'center' },
  tabIcon: { fontSize: 18 },
  tabBtnActive: { backgroundColor: '#1A5FD0' },
  tabText: { fontSize: 13, marginTop: 2, color: '#52606D', fontWeight: '600' },
  tabTextActive: { color: '#fff' },

  monthNav: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  arrow: { fontSize: 26, color: '#1A5FD0', paddingHorizontal: 8 },
  monthTitle: { fontSize: 20, fontWeight: '700', color: '#1F2933' },

  totalCard: { backgroundColor: '#1A5FD0', borderRadius: 16, padding: 20, marginBottom: 16, alignItems: 'flex-end' },
  totalLabel: { color: '#FFFFFF', fontSize: 14 },
  totalValue: { color: '#fff', fontSize: 34, fontWeight: '800', marginTop: 4 },
  totalSub: { color: '#FFFFFF', fontSize: 14, marginTop: 6 },

  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#1F2933', marginBottom: 10, textAlign: 'right' },
  rowBetween: { flexDirection: 'row-reverse', justifyContent: 'space-between', marginBottom: 4 },
  text: { fontSize: 15, color: '#1F2933', textAlign: 'right' },
  textBold: { fontSize: 15, color: '#1F2933', fontWeight: '700', textAlign: 'right' },
  subText: { fontSize: 13, color: '#616E7C', textAlign: 'right', marginTop: 2 },
  barTrack: {
    height: 8,
    backgroundColor: '#EEF2F6',
    borderRadius: 4,
    overflow: 'hidden',
    flexDirection: 'row-reverse',
  },
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
  empty: { textAlign: 'center', color: '#616E7C', marginTop: 24, fontSize: 15, lineHeight: 22 },

  amountBox: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingHorizontal: 16,
    marginBottom: 20,
  },
  currency: { fontSize: 32, color: '#616E7C', marginLeft: 8 },
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
  saveBtn: { backgroundColor: '#1A5FD0', borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  dateBox: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 10,
  },
  dateText: { fontSize: 16, fontWeight: '700', color: '#1F2933' },
  quickDates: { flexDirection: 'row-reverse', gap: 8, marginBottom: 20 },
  quickChip: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20, backgroundColor: '#fff' },
  quickChipSelected: { backgroundColor: '#1A5FD0' },
  quickChipText: { fontSize: 14, color: '#52606D', fontWeight: '600' },
  quickChipTextSelected: { color: '#fff' },
  secondaryBtn: { paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  secondaryText: { fontSize: 16, color: '#52606D', fontWeight: '600' },
  docTitle: { fontSize: 22, fontWeight: '800', color: '#1F2933', textAlign: 'right', marginBottom: 12 },
  docHeading: { fontSize: 16, fontWeight: '700', color: '#1F2933', textAlign: 'right', marginBottom: 4 },
  docBody: { fontSize: 15, lineHeight: 23, color: '#323F4B', textAlign: 'right' },
  linkRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', paddingVertical: 14 },
  linkRowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#D9E0E8' },
  chartArea: { flexDirection: 'row-reverse', alignItems: 'flex-end', height: CHART_HEIGHT + 22 },
  barCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%' },
  trendBar: { width: '55%', borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  barValue: { fontSize: 11, fontWeight: '700', color: '#1F2933', marginBottom: 4 },
  chartBaseline: { height: 1, backgroundColor: '#D9E0E8' },
  chartLabels: { flexDirection: 'row-reverse', marginTop: 6 },
  barLabel: { textAlign: 'center', paddingVertical: 4, fontSize: 12, color: '#616E7C' },
  barLabelSelected: { color: '#1F2933', fontWeight: '700' },
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
