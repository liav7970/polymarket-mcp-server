import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Text, TextInput } from './a11y';
import { APP_NAME, LAST_UPDATED, LEGAL_DOCS, LegalDoc } from './legal';
import { LegalDocView } from './LegalDocView';
import { authRedirectUrl, supabase } from './supabase';

const MIN_PASSWORD = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Supabase error messages are English; show the common ones in Hebrew.
function translateError(message: string) {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) return 'אימייל או סיסמה שגויים.';
  if (m.includes('email not confirmed')) return 'צריך לאשר את האימייל קודם. חפש את המייל ששלחנו (בדוק גם בספאם).';
  if (m.includes('already registered')) return 'כבר קיים משתמש עם האימייל הזה. נסה להתחבר.';
  if (m.includes('rate limit') || m.includes('too many')) return 'יותר מדי ניסיונות. נסה שוב בעוד כמה דקות.';
  if (m.includes('password')) return 'הסיסמה לא עומדת בדרישות. נדרשים לפחות 8 תווים.';
  if (m.includes('network') || m.includes('fetch')) return 'אין חיבור לשרת. בדוק את החיבור לאינטרנט.';
  return 'משהו השתבש. נסה שוב.';
}

type Mode = 'login' | 'signup' | 'reset' | 'check-email' | 'reset-sent';

export function AuthScreen() {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [doc, setDoc] = useState<LegalDoc | null>(null);

  const switchMode = (m: Mode) => {
    setMode(m);
    setError('');
    setInfo('');
    setPassword('');
    setConfirm('');
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setInfo('');
    try {
      await fn();
    } catch (e) {
      setError(translateError(e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };

  const cleanEmail = email.trim().toLowerCase();

  const login = () =>
    run(async () => {
      if (!EMAIL_RE.test(cleanEmail)) return setError('נא להזין כתובת אימייל תקינה.');
      const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
      if (error) throw error;
    });

  const signup = () =>
    run(async () => {
      if (!EMAIL_RE.test(cleanEmail)) return setError('נא להזין כתובת אימייל תקינה.');
      if (password.length < MIN_PASSWORD) return setError(`הסיסמה צריכה להכיל לפחות ${MIN_PASSWORD} תווים.`);
      if (password !== confirm) return setError('הסיסמאות לא תואמות.');
      if (!agreed) return setError('כדי להירשם צריך לאשר את תנאי השימוש ומדיניות הפרטיות.');
      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: {
          emailRedirectTo: authRedirectUrl(),
          // Record of consent: when and to which version of the terms.
          data: { terms_accepted_at: new Date().toISOString(), terms_version: LAST_UPDATED },
        },
      });
      if (error) throw error;
      // Supabase answers an existing, confirmed email with a user that has no identities.
      if (data.user && data.user.identities?.length === 0) throw new Error('already registered');
      if (!data.session) switchMode('check-email');
    });

  const resendConfirmation = () =>
    run(async () => {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: cleanEmail,
        options: { emailRedirectTo: authRedirectUrl() },
      });
      if (error) throw error;
      setInfo('שלחנו שוב. בדוק את תיבת הדואר (וגם את הספאם).');
    });

  const sendReset = () =>
    run(async () => {
      if (!EMAIL_RE.test(cleanEmail)) return setError('נא להזין כתובת אימייל תקינה.');
      const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, { redirectTo: authRedirectUrl() });
      if (error) throw error;
      switchMode('reset-sent');
    });

  if (doc) return <LegalDocView doc={doc} onBack={() => setDoc(null)} />;

  const title =
    mode === 'signup'
      ? 'צור משתמש'
      : mode === 'reset'
        ? 'שכחתי סיסמה'
        : mode === 'check-email' || mode === 'reset-sent'
          ? 'בדוק את האימייל'
          : 'התחברות';

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.logo}>₪</Text>
        <Text accessibilityRole="header" style={styles.appName}>
          {APP_NAME}
        </Text>
        <Text style={styles.tagline}>מעקב הוצאות ותקציב אישי</Text>

        <View style={styles.card}>
          {mode === 'login' || mode === 'signup' ? (
            // Login and sign-up side by side, so a new visitor sees "צור משתמש" right away.
            <View style={styles.segment} accessibilityRole="tablist">
              {(
                [
                  ['login', 'התחברות'],
                  ['signup', 'צור משתמש'],
                ] as const
              ).map(([m, label]) => {
                const selected = mode === m;
                return (
                  <Pressable
                    key={m}
                    accessibilityRole="tab"
                    accessibilityState={{ selected }}
                    onPress={() => !selected && switchMode(m)}
                    style={[styles.segBtn, selected && styles.segBtnOn]}
                  >
                    <Text style={[styles.segText, selected && styles.segTextOn]}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <Text accessibilityRole="header" style={styles.title}>
              {title}
            </Text>
          )}

          {mode === 'check-email' && (
            <>
              <Text style={styles.body}>
                שלחנו מייל אימות אל <Text style={styles.bold}>{cleanEmail}</Text>. לחץ על הקישור שבמייל כדי להפעיל את
                החשבון, ואז התחבר כאן.
              </Text>
              <Text style={[styles.body, { marginTop: 8 }]}>לא הגיע? בדוק בתיקיית הספאם.</Text>
              <LinkButton label="שליחה חוזרת של המייל" onPress={resendConfirmation} disabled={busy} />
              <LinkButton label="חזרה להתחברות" onPress={() => switchMode('login')} />
            </>
          )}

          {mode === 'reset-sent' && (
            <>
              <Text style={styles.body}>
                אם קיים חשבון עם <Text style={styles.bold}>{cleanEmail}</Text>, שלחנו אליו קישור לאיפוס הסיסמה.
              </Text>
              <LinkButton label="חזרה להתחברות" onPress={() => switchMode('login')} />
            </>
          )}

          {(mode === 'login' || mode === 'signup' || mode === 'reset') && (
            <>
              <Text style={styles.label}>אימייל</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                textContentType="emailAddress"
                placeholder="name@example.com"
                placeholderTextColor="#6B7785"
                accessibilityLabel="אימייל"
              />

              {mode !== 'reset' && (
                <>
                  <Text style={styles.label}>סיסמה</Text>
                  <TextInput
                    style={styles.input}
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry
                    autoCapitalize="none"
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                    textContentType={mode === 'signup' ? 'newPassword' : 'password'}
                    placeholder={mode === 'signup' ? `לפחות ${MIN_PASSWORD} תווים` : ''}
                    placeholderTextColor="#6B7785"
                    accessibilityLabel="סיסמה"
                    onSubmitEditing={mode === 'login' ? login : undefined}
                  />
                </>
              )}

              {mode === 'signup' && (
                <>
                  <Text style={styles.label}>אימות סיסמה</Text>
                  <TextInput
                    style={styles.input}
                    value={confirm}
                    onChangeText={setConfirm}
                    secureTextEntry
                    autoCapitalize="none"
                    autoComplete="new-password"
                    textContentType="newPassword"
                    placeholderTextColor="#6B7785"
                    accessibilityLabel="אימות סיסמה"
                  />

                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: agreed }}
                    onPress={() => {
                      setAgreed((a) => !a);
                      setError('');
                    }}
                    style={styles.checkRow}
                  >
                    <View style={[styles.checkbox, agreed && styles.checkboxOn]}>
                      {agreed && <Text style={styles.checkMark}>✓</Text>}
                    </View>
                    <Text style={[styles.body, { flex: 1 }]}>
                      קראתי ואני מסכים ל
                      <Text style={styles.link} onPress={() => setDoc(LEGAL_DOCS.find((d) => d.id === 'terms')!)}>
                        תנאי השימוש
                      </Text>{' '}
                      ול
                      <Text style={styles.link} onPress={() => setDoc(LEGAL_DOCS.find((d) => d.id === 'privacy')!)}>
                        מדיניות הפרטיות
                      </Text>
                    </Text>
                  </Pressable>
                </>
              )}

              {mode === 'reset' && (
                <Text style={[styles.body, { marginBottom: 12 }]}>נשלח אליך קישור לבחירת סיסמה חדשה.</Text>
              )}

              {error ? (
                <Text accessibilityLiveRegion="polite" style={styles.error}>
                  {error}
                </Text>
              ) : null}
              {info ? <Text style={styles.info}>{info}</Text> : null}

              <Pressable
                accessibilityRole="button"
                style={[styles.primaryBtn, busy && { opacity: 0.6 }]}
                onPress={mode === 'login' ? login : mode === 'signup' ? signup : sendReset}
                disabled={busy}
              >
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryText}>
                    {mode === 'login' ? 'התחברות' : mode === 'signup' ? 'צור משתמש' : 'שליחת קישור'}
                  </Text>
                )}
              </Pressable>

              {mode === 'login' && (
                <>
                  <LinkButton label="שכחתי סיסמה" onPress={() => switchMode('reset')} />
                  <View style={styles.divider} />
                  <Text style={[styles.body, { textAlign: 'center' }]}>אין לך חשבון?</Text>
                  <LinkButton label="צור משתמש חדש" onPress={() => switchMode('signup')} strong />
                </>
              )}
              {mode === 'reset' && <LinkButton label="חזרה להתחברות" onPress={() => switchMode('login')} />}
            </>
          )}
          {(mode === 'check-email' || mode === 'reset-sent') && error ? (
            <Text style={styles.error}>{error}</Text>
          ) : null}
          {mode === 'check-email' && info ? <Text style={styles.info}>{info}</Text> : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// Shown after the user opens a password-reset link.
export function NewPasswordScreen({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (password.length < MIN_PASSWORD) return setError(`הסיסמה צריכה להכיל לפחות ${MIN_PASSWORD} תווים.`);
    if (password !== confirm) return setError('הסיסמאות לא תואמות.');
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return setError(translateError(error.message));
    onDone();
  };

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.title}>
          בחירת סיסמה חדשה
        </Text>
        <Text style={styles.label}>סיסמה חדשה</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          accessibilityLabel="סיסמה חדשה"
        />
        <Text style={styles.label}>אימות סיסמה</Text>
        <TextInput
          style={styles.input}
          value={confirm}
          onChangeText={setConfirm}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          accessibilityLabel="אימות סיסמה"
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable accessibilityRole="button" style={styles.primaryBtn} onPress={save} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>שמירה</Text>}
        </Pressable>
      </View>
    </ScrollView>
  );
}

export function NotConfiguredScreen() {
  return (
    <View style={[styles.container, { flex: 1, justifyContent: 'center' }]}>
      <View style={styles.card}>
        <Text style={styles.title}>חסרה הגדרת שרת</Text>
        <Text style={styles.body}>
          כדי להפעיל משתמשים צריך להגדיר את EXPO_PUBLIC_SUPABASE_URL ו-EXPO_PUBLIC_SUPABASE_ANON_KEY בקובץ .env (ראה
          .env.example).
        </Text>
      </View>
    </View>
  );
}

function LinkButton({
  label,
  onPress,
  disabled,
  strong,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  strong?: boolean;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled} style={styles.linkBtn} hitSlop={6}>
      <Text style={[styles.linkBtnText, strong && { fontWeight: '800' }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingTop: 32, paddingBottom: 40 },
  logo: {
    alignSelf: 'center',
    width: 72,
    height: 72,
    lineHeight: 72,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#1A5FD0',
    color: '#fff',
    fontSize: 40,
    fontWeight: '800',
    textAlign: 'center',
  },
  appName: { fontSize: 30, fontWeight: '800', color: '#1F2933', textAlign: 'center', marginTop: 12 },
  tagline: { fontSize: 15, color: '#616E7C', textAlign: 'center', marginBottom: 24 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 20 },
  segment: { flexDirection: 'row-reverse', backgroundColor: '#F4F6FA', borderRadius: 12, padding: 4, marginBottom: 20 },
  segBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  segBtnOn: { backgroundColor: '#1A5FD0' },
  segText: { fontSize: 17, fontWeight: '700', color: '#323F4B' },
  segTextOn: { color: '#fff' },
  title: { fontSize: 22, fontWeight: '800', color: '#1F2933', textAlign: 'right', marginBottom: 16 },
  label: { fontSize: 15, fontWeight: '700', color: '#1F2933', textAlign: 'right', marginBottom: 6 },
  input: {
    backgroundColor: '#F4F6FA',
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: '#1F2933',
    textAlign: 'right',
    marginBottom: 14,
  },
  body: { fontSize: 15, lineHeight: 22, color: '#323F4B', textAlign: 'right' },
  bold: { fontWeight: '700', color: '#1F2933' },
  link: { color: '#1A5FD0', fontWeight: '700', textDecorationLine: 'underline' },
  checkRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, marginBottom: 16 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#616E7C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: '#1A5FD0', borderColor: '#1A5FD0' },
  checkMark: { color: '#fff', fontWeight: '800', fontSize: 15 },
  error: { color: '#C92A2A', fontSize: 15, textAlign: 'right', marginBottom: 12 },
  info: { color: '#1F7A4D', fontSize: 15, textAlign: 'right', marginVertical: 12 },
  primaryBtn: {
    backgroundColor: '#1A5FD0',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  primaryText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  linkBtn: { paddingVertical: 12, alignItems: 'center' },
  linkBtnText: { color: '#1A5FD0', fontSize: 16, fontWeight: '600' },
  divider: { height: 1, backgroundColor: '#E4E7EB', marginVertical: 8 },
});
