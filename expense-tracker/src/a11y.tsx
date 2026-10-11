import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  Text as RNText,
  TextInput as RNTextInput,
  ScrollView,
  StyleSheet,
  TextInputProps,
  TextProps,
  TextStyle,
  ViewStyle,
  View,
} from 'react-native';
import { LEGAL_DOCS } from './legal';
import { LegalDocView } from './LegalDocView';

// Accessibility menu ("תפריט נגישות"): user-adjustable text size, high contrast and readable font.
// The app's Text / TextInput below read these settings, so every screen follows them.

export type A11ySettings = { textScale: number; highContrast: boolean; readableFont: boolean; underlineLinks: boolean };

const DEFAULTS: A11ySettings = { textScale: 1, highContrast: false, readableFont: false, underlineLinks: false };
const KEY = 'a11y:v1';
const SCALES = [
  { value: 1, label: 'רגיל' },
  { value: 1.2, label: 'גדול' },
  { value: 1.4, label: 'גדול מאוד' },
];

const A11yContext = createContext<{ settings: A11ySettings; update: (s: Partial<A11ySettings>) => void }>({
  settings: DEFAULTS,
  update: () => {},
});

export const useA11y = () => useContext(A11yContext);

export function A11yProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(DEFAULTS);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => raw && setSettings({ ...DEFAULTS, ...JSON.parse(raw) }))
      .catch(() => {});
  }, []);

  const update = (s: Partial<A11ySettings>) =>
    setSettings((prev) => {
      const next = { ...prev, ...s };
      AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });

  return <A11yContext.Provider value={{ settings, update }}>{children}</A11yContext.Provider>;
}

const LINK_COLORS = new Set(['#1a5fd0']);
const LIGHT_COLORS = new Set(['#fff', '#ffffff', 'white']);

function adjust(style: TextProps['style'], s: A11ySettings): TextStyle {
  const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle;
  const out: TextStyle = {};
  if (s.textScale !== 1) {
    out.fontSize = (flat.fontSize ?? 14) * s.textScale;
    if (flat.lineHeight) out.lineHeight = flat.lineHeight * s.textScale;
  }
  const color = typeof flat.color === 'string' ? flat.color.toLowerCase() : undefined;
  if (s.highContrast && !(color && LIGHT_COLORS.has(color))) {
    // Links stay blue (darker) so they remain recognizable; everything else goes black.
    out.color = color && LINK_COLORS.has(color) ? '#003A9E' : '#000000';
  }
  if (s.readableFont) {
    out.fontFamily = 'Arial';
    out.letterSpacing = 0.3;
  }
  if (s.underlineLinks && color && LINK_COLORS.has(color)) out.textDecorationLine = 'underline';
  return out;
}

export function Text(props: TextProps) {
  const { settings } = useA11y();
  return <RNText {...props} style={[props.style, adjust(props.style, settings)]} />;
}

export function TextInput(props: TextInputProps) {
  const { settings } = useA11y();
  return <RNTextInput {...props} style={[props.style, adjust(props.style, settings)]} />;
}

// Floating button that opens the accessibility menu; `style` positions it (bottom offset).
export function A11yButton({ style }: { style: ViewStyle }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="תפריט נגישות"
        onPress={() => setOpen(true)}
        style={[styles.fab, style]}
        hitSlop={6}
      >
        <RNText style={styles.fabIcon}>♿</RNText>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <A11yMenu onClose={() => setOpen(false)} />
      </Modal>
    </>
  );
}

function A11yMenu({ onClose }: { onClose: () => void }) {
  const { settings, update } = useA11y();
  const [showStatement, setShowStatement] = useState(false);
  const statement = LEGAL_DOCS.find((d) => d.id === 'accessibility')!;

  return (
    <View style={styles.backdrop}>
      <View style={styles.sheet} accessibilityViewIsModal>
        {showStatement ? (
          <LegalDocView doc={statement} onBack={() => setShowStatement(false)} />
        ) : (
          <ScrollView contentContainerStyle={{ padding: 20 }}>
            <View style={styles.headerRow}>
              <Text accessibilityRole="header" style={styles.title}>
                ♿ תפריט נגישות
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="סגירת תפריט הנגישות"
                onPress={onClose}
                hitSlop={10}
              >
                <RNText style={styles.close}>✕</RNText>
              </Pressable>
            </View>

            <Text style={styles.label}>גודל טקסט</Text>
            <View style={styles.segment}>
              {SCALES.map((sc) => {
                const selected = settings.textScale === sc.value;
                return (
                  <Pressable
                    key={sc.value}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => update({ textScale: sc.value })}
                    style={[styles.segBtn, selected && styles.segBtnOn]}
                  >
                    <RNText style={[styles.segText, { fontSize: 15 * sc.value }, selected && styles.segTextOn]}>
                      {sc.label}
                    </RNText>
                  </Pressable>
                );
              })}
            </View>

            <Toggle
              label="ניגודיות גבוהה"
              hint="טקסט שחור כהה במקום אפור"
              value={settings.highContrast}
              onChange={(v) => update({ highContrast: v })}
            />
            <Toggle
              label="גופן קריא"
              hint="גופן פשוט עם ריווח רחב יותר"
              value={settings.readableFont}
              onChange={(v) => update({ readableFont: v })}
            />
            <Toggle
              label="הדגשת קישורים"
              hint="קו תחתון לכל הקישורים"
              value={settings.underlineLinks}
              onChange={(v) => update({ underlineLinks: v })}
            />

            <Pressable accessibilityRole="button" style={styles.rowBtn} onPress={() => setShowStatement(true)}>
              <Text style={styles.rowBtnText}>הצהרת נגישות</Text>
            </Pressable>
            <Pressable accessibilityRole="button" style={styles.rowBtn} onPress={() => update(DEFAULTS)}>
              <Text style={styles.rowBtnText}>איפוס הגדרות נגישות</Text>
            </Pressable>
          </ScrollView>
        )}
      </View>
    </View>
  );
}

function Toggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
      accessibilityHint={hint}
      onPress={() => onChange(!value)}
      style={styles.toggleRow}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.toggleLabel}>{label}</Text>
        <Text style={styles.toggleHint}>{hint}</Text>
      </View>
      <View style={[styles.switch, value && styles.switchOn]}>
        <View style={[styles.knob, value && styles.knobOn]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    left: 12,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#1A5FD0',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  fabIcon: { fontSize: 26, color: '#fff' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '85%' },
  headerRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 20, fontWeight: '800', color: '#1F2933', textAlign: 'right' },
  close: { fontSize: 22, color: '#323F4B', paddingHorizontal: 6 },
  label: { fontSize: 15, fontWeight: '700', color: '#1F2933', textAlign: 'right', marginBottom: 8 },
  segment: { flexDirection: 'row-reverse', gap: 8, marginBottom: 16 },
  segBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: '#F4F6FA', alignItems: 'center' },
  segBtnOn: { backgroundColor: '#1A5FD0' },
  segText: { color: '#323F4B', fontWeight: '600' },
  segTextOn: { color: '#fff' },
  toggleRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#D9E0E8',
  },
  toggleLabel: { fontSize: 16, fontWeight: '600', color: '#1F2933', textAlign: 'right' },
  toggleHint: { fontSize: 13, color: '#616E7C', textAlign: 'right', marginTop: 2 },
  switch: {
    width: 48,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#9AA5B1',
    padding: 3,
    flexDirection: 'row-reverse',
  },
  switchOn: { backgroundColor: '#1A5FD0', flexDirection: 'row' },
  knob: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff' },
  knobOn: {},
  rowBtn: { paddingVertical: 14 },
  rowBtnText: { fontSize: 16, fontWeight: '600', color: '#1A5FD0', textAlign: 'right' },
});
