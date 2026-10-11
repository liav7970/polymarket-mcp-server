import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LAST_UPDATED, LegalDoc } from './legal';

export function LegalDocView({ doc, onBack }: { doc: LegalDoc; onBack: () => void }) {
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
      <Pressable accessibilityRole="button" onPress={onBack} hitSlop={10} style={{ marginBottom: 12 }}>
        <Text style={styles.back}>→ חזרה</Text>
      </Pressable>
      <Text accessibilityRole="header" style={styles.title}>
        {doc.title}
      </Text>
      {doc.sections.map((sec) => (
        <View key={sec.heading} style={{ marginBottom: 16 }}>
          <Text accessibilityRole="header" style={styles.heading}>
            {sec.heading}
          </Text>
          <Text style={styles.body}>{sec.body}</Text>
        </View>
      ))}
      <Text style={styles.updated}>עדכון אחרון: {LAST_UPDATED}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  back: { fontSize: 15, color: '#1A5FD0', fontWeight: '600', textAlign: 'right' },
  title: { fontSize: 22, fontWeight: '800', color: '#1F2933', textAlign: 'right', marginBottom: 12 },
  heading: { fontSize: 16, fontWeight: '700', color: '#1F2933', textAlign: 'right', marginBottom: 4 },
  body: { fontSize: 15, lineHeight: 23, color: '#323F4B', textAlign: 'right' },
  updated: { fontSize: 13, color: '#616E7C', textAlign: 'right' },
});
