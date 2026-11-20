import React from 'react';
import { Text, View, StyleSheet, TextStyle } from 'react-native';

interface Props {
  text: string;
  color: string;
  style?: TextStyle;
}

/** Minimal markdown for bot replies: **bold**, "- " bullets and "1." lists. */
export function RichText({ text, color, style }: Props) {
  const lines = text.replace(/\r/g, '').split('\n');
  return (
    <View style={{ gap: 6 }}>
      {lines.map((raw, i) => {
        const line = raw.trimEnd();
        if (!line.trim()) return <View key={i} style={{ height: 2 }} />;
        const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
        const numbered = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
        if (bullet || numbered) {
          return (
            <View key={i} style={styles.row}>
              <Text style={[styles.base, { color }, style]}>{numbered ? `${numbered[1]}.` : '•'}</Text>
              <Text style={[styles.base, styles.flex, { color }, style]}>
                {renderInline(numbered ? numbered[2] : bullet![1], color)}
              </Text>
            </View>
          );
        }
        return (
          <Text key={i} style={[styles.base, { color }, style]}>
            {renderInline(line, color)}
          </Text>
        );
      })}
    </View>
  );
}

function renderInline(text: string, color: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
      <Text key={i} style={{ fontWeight: '700', color }}>
        {part.slice(2, -2)}
      </Text>
    ) : (
      <Text key={i}>{part.replace(/\*\*/g, '')}</Text>
    ),
  );
}

const styles = StyleSheet.create({
  base: { fontSize: 15, lineHeight: 22 },
  row: { flexDirection: 'row', gap: 8 },
  flex: { flex: 1 },
});
