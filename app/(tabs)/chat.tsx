import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  Animated,
  Alert,
  ScrollView,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/context/ThemeContext';
import { Screen } from '@/components/Screen';
import { ScreenHeader } from '@/components/ScreenHeader';
import { RichText } from '@/components/chat/RichText';
import { spacing, radius } from '@/theme/spacing';
import { typography } from '@/theme/typography';
import type { AIPreference } from '@/services/aiClient';
import {
  ChatAction,
  ChatMessage,
  askSaathi,
  loadAIPreference,
  saveAIPreference,
  clearChat,
  friendlyError,
  loadChat,
  saveChat,
  welcomeMessage,
} from '@/services/chatService';

const MAX_INPUT = 500;

const ACTION_LABEL: Record<ChatAction, { label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }> = {
  recognize: { label: 'Open Recognize', icon: 'scan-outline' },
  learn: { label: 'Open Learn', icon: 'book-outline' },
  studio: { label: 'Open 3D Studio', icon: 'cube-outline' },
  academy: { label: 'Open AI Academy', icon: 'sparkles-outline' },
  history: { label: 'View history', icon: 'time-outline' },
  lesson: { label: 'Open lesson', icon: 'school-outline' },
};

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export default function Chat() {
  const { colors } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ prefill?: string; ctx?: string; nonce?: string }>();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [pref, setPref] = useState<AIPreference>('auto');
  const prefRef = useRef<AIPreference>('auto');
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const handledNonce = useRef<string | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    loadAIPreference().then((p) => {
      setPref(p);
      prefRef.current = p;
    });
  }, []);

  const choosePref = (p: AIPreference) => {
    setPref(p);
    prefRef.current = p;
    saveAIPreference(p);
  };

  useEffect(() => {
    let cancelled = false;
    loadChat().then((saved) => {
      if (cancelled) return;
      setMessages(saved.length ? saved : [welcomeMessage()]);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }, []);

  const send = useCallback(
    async (rawText: string, appContext?: string) => {
      const text = rawText.trim().slice(0, MAX_INPUT);
      if (!text || sending) return;

      const history = messagesRef.current.filter((m) => !m.error);
      const userMsg: ChatMessage = { id: uid(), role: 'user', text, createdAt: Date.now() };
      // strip stale chips / error bubbles from older turns
      const base = messagesRef.current.filter((m) => !m.error).map((m) => ({ ...m, suggestions: undefined }));
      const next = [...base, userMsg];
      setMessages(next);
      setInput('');
      setSending(true);
      scrollToEnd();

      try {
        const reply = await askSaathi(history, text, appContext, prefRef.current);
        const botMsg: ChatMessage = {
          id: uid(),
          role: 'bot',
          text: reply.text,
          suggestions: reply.suggestions,
          action: reply.action,
          letter: reply.letter,
          provider: reply.provider,
          model: reply.model,
          createdAt: Date.now(),
        };
        const done = [...next, botMsg];
        setMessages(done);
        saveChat(done);
      } catch (err) {
        console.warn('[chat] failed', err);
        setMessages([
          ...next,
          { id: uid(), role: 'bot', text: friendlyError(err, prefRef.current), error: true, createdAt: Date.now() },
        ]);
        saveChat(next);
      } finally {
        setSending(false);
        scrollToEnd();
      }
    },
    [sending, scrollToEnd],
  );

  // Open from another screen with a question (e.g. "Ask Saathi" in Recognize)
  useEffect(() => {
    if (!loaded || !params.prefill || !params.nonce) return;
    if (handledNonce.current === params.nonce) return;
    handledNonce.current = params.nonce;
    send(String(params.prefill), params.ctx ? String(params.ctx) : undefined);
  }, [loaded, params.prefill, params.nonce, params.ctx, send]);

  const retry = () => {
    const lastUser = [...messagesRef.current].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;
    // drop the error bubble and the user message so send() re-adds it
    setMessages((cur) => {
      const trimmed = cur.filter((m) => !m.error);
      const idx = trimmed.map((m) => m.id).lastIndexOf(lastUser.id);
      return idx >= 0 ? trimmed.slice(0, idx) : trimmed;
    });
    messagesRef.current = messagesRef.current.filter((m) => !m.error && m.id !== lastUser.id);
    send(lastUser.text);
  };

  const confirmClear = () =>
    Alert.alert('Clear chat', 'Delete this whole conversation and start fresh with Saathi?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: async () => {
          await clearChat();
          setMessages([welcomeMessage()]);
        },
      },
    ]);

  const openAction = (m: ChatMessage) => {
    switch (m.action) {
      case 'recognize':
        return router.push('/(tabs)/recognize');
      case 'learn':
        return router.push('/(tabs)/learn');
      case 'studio':
        return router.push('/learn-3d');
      case 'academy':
        return router.push('/ai-learn');
      case 'history':
        return router.push('/(tabs)/history');
      case 'lesson':
        return router.push(`/lesson/${m.letter ?? 'A'}`);
    }
  };

  const lastBotId = useMemo(() => [...messages].reverse().find((m) => m.role === 'bot')?.id, [messages]);
  const canSend = input.trim().length > 0 && !sending;
  const hasConversation = messages.some((m) => m.id !== 'welcome');

  const renderItem = ({ item }: { item: ChatMessage }) => {
    const isUser = item.role === 'user';
    const showChips = !isUser && item.id === lastBotId && !sending && !!item.suggestions?.length;
    return (
      <View style={[styles.msgRow, isUser ? styles.rowUser : styles.rowBot]}>
        {!isUser && (
          <View style={[styles.avatar, { backgroundColor: colors.primarySoft }]}>
            <Ionicons name="sparkles" size={14} color={colors.primary} />
          </View>
        )}
        <View style={{ maxWidth: '82%' }}>
          <View
            style={[
              styles.bubble,
              isUser
                ? { backgroundColor: colors.primary, borderBottomRightRadius: 6 }
                : {
                    backgroundColor: colors.surface,
                    borderColor: item.error ? colors.error : colors.border,
                    borderWidth: 1,
                    borderBottomLeftRadius: 6,
                  },
            ]}
          >
            {isUser ? (
              <Text selectable style={[styles.userText]}>
                {item.text}
              </Text>
            ) : (
              <RichText text={item.text} color={item.error ? colors.error : colors.textPrimary} />
            )}
          </View>

          {!isUser && item.error && (
            <View style={styles.errorActions}>
              <Pressable onPress={retry} style={styles.inlineBtn} accessibilityRole="button">
                <Ionicons name="refresh" size={14} color={colors.primary} />
                <Text style={[typography.small, { color: colors.primary }]}>Try again</Text>
              </Pressable>
              {pref !== 'auto' && (
                <Pressable
                  onPress={() => {
                    choosePref('auto');
                    retry();
                  }}
                  style={styles.inlineBtn}
                  accessibilityRole="button"
                >
                  <Ionicons name="shuffle" size={14} color={colors.primary} />
                  <Text style={[typography.small, { color: colors.primary }]}>Use Auto and retry</Text>
                </Pressable>
              )}
            </View>
          )}

          {!isUser && item.provider === 'gemma' && (
            <Text style={[styles.meta, { color: colors.textMuted }]}>
              Answered by Gemma — can be slower and less accurate
            </Text>
          )}

          {!isUser && item.action && (
            <Pressable
              onPress={() => openAction(item)}
              accessibilityRole="button"
              style={[styles.actionBtn, { backgroundColor: colors.primarySoft, borderColor: colors.primary }]}
            >
              <Ionicons name={ACTION_LABEL[item.action].icon} size={15} color={colors.primary} />
              <Text style={[typography.small, { color: colors.primary }]}>
                {item.action === 'lesson' && item.letter ? `Open lesson ${item.letter}` : ACTION_LABEL[item.action].label}
              </Text>
            </Pressable>
          )}

          {showChips && (
            <View style={styles.chips}>
              {item.suggestions!.map((s) => (
                <Pressable
                  key={s}
                  onPress={() => send(s)}
                  style={[styles.chip, { borderColor: colors.border, backgroundColor: colors.surface }]}
                >
                  <Text style={[typography.small, { color: colors.textPrimary }]}>{s}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </View>
    );
  };

  return (
    <Screen edges={['top']}>
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg }}>
        <ScreenHeader
          title="Saathi"
          subtitle="Your ISL learning companion"
          rightNode={
            <Pressable
              onPress={confirmClear}
              disabled={!hasConversation || sending}
              accessibilityRole="button"
              accessibilityLabel="Clear chat"
              style={[
                styles.clearBtn,
                { borderColor: colors.border, backgroundColor: colors.surface, opacity: hasConversation && !sending ? 1 : 0.4 },
              ]}
            >
              <Ionicons name="trash-outline" size={16} color={colors.textSecondary} />
              <Text style={[typography.small, { color: colors.textSecondary, fontWeight: '700' }]}>Clear chat</Text>
            </Pressable>
          }
        />
      </View>

      <ModelPicker value={pref} onChange={choosePref} disabled={sending} />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={scrollToEnd}
          ListFooterComponent={sending ? <TypingBubble /> : undefined}
        />

        {messages.length <= 1 && !sending && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.starterRow}
            keyboardShouldPersistTaps="handled"
          >
            {['How is ISL different from ASL?', 'How should I practice fingerspelling?', 'Quiz me on greetings', 'How do I use this app?'].map(
              (s) => (
                <Pressable
                  key={s}
                  onPress={() => send(s)}
                  style={[styles.chip, { borderColor: colors.border, backgroundColor: colors.surface }]}
                >
                  <Text style={[typography.small, { color: colors.textPrimary }]}>{s}</Text>
                </Pressable>
              ),
            )}
          </ScrollView>
        )}

        <View style={[styles.inputBar, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Ask about ISL, practice, the app…"
            placeholderTextColor={colors.textMuted}
            style={[
              styles.input,
              { color: colors.textPrimary, backgroundColor: colors.surface, borderColor: colors.border },
            ]}
            multiline
            maxLength={MAX_INPUT}
            editable={!sending}
            returnKeyType="send"
            blurOnSubmit={false}
            onSubmitEditing={() => canSend && send(input)}
          />
          <Pressable
            onPress={() => send(input)}
            disabled={!canSend}
            accessibilityRole="button"
            accessibilityLabel="Send message"
            style={[styles.sendBtn, { backgroundColor: canSend ? colors.primary : colors.border }]}
          >
            <Ionicons name="arrow-up" size={20} color="#FFFFFF" />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const MODEL_OPTIONS: { key: AIPreference; label: string; hint: string }[] = [
  { key: 'auto', label: 'Auto', hint: 'Gemini, with Gemma as backup' },
  { key: 'gemini', label: 'Google Gemini', hint: 'Fastest and most accurate' },
  { key: 'gemma', label: 'Gemma', hint: 'Open model · slower, less accurate' },
];

function ModelPicker({
  value,
  onChange,
  disabled,
}: {
  value: AIPreference;
  onChange: (p: AIPreference) => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const active = MODEL_OPTIONS.find((o) => o.key === value)!;
  return (
    <View style={styles.pickerWrap}>
      <View style={[styles.segment, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {MODEL_OPTIONS.map((o) => {
          const on = o.key === value;
          return (
            <Pressable
              key={o.key}
              onPress={() => onChange(o.key)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={[styles.segmentBtn, on && { backgroundColor: colors.primary }]}
            >
              <Text style={[typography.small, { color: on ? '#FFFFFF' : colors.textSecondary, fontWeight: '700' }]}>
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={[styles.pickerHint, { color: colors.textMuted }]}>{active.hint}</Text>
    </View>
  );
}

function TypingBubble() {
  const { colors } = useTheme();
  const [dots] = useState(() => [0, 1, 2].map(() => new Animated.Value(0.3)));

  useEffect(() => {
    const loops = dots.map((d, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 160),
          Animated.timing(d, { toValue: 1, duration: 320, useNativeDriver: true }),
          Animated.timing(d, { toValue: 0.3, duration: 320, useNativeDriver: true }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [dots]);

  return (
    <View style={[styles.msgRow, styles.rowBot]}>
      <View style={[styles.avatar, { backgroundColor: colors.primarySoft }]}>
        <Ionicons name="sparkles" size={14} color={colors.primary} />
      </View>
      <View
        style={[
          styles.bubble,
          styles.typing,
          { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderBottomLeftRadius: 6 },
        ]}
      >
        {dots.map((d, i) => (
          <Animated.View key={i} style={[styles.dot, { backgroundColor: colors.textMuted, opacity: d }]} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  clearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 38,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  pickerWrap: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  segment: { flexDirection: 'row', borderRadius: radius.pill, borderWidth: 1, padding: 3 },
  segmentBtn: { flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: radius.pill },
  pickerHint: { fontSize: 11, textAlign: 'center', marginTop: 6 },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.md, flexGrow: 1 },
  msgRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  rowUser: { justifyContent: 'flex-end' },
  rowBot: { justifyContent: 'flex-start' },
  avatar: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  bubble: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.lg },
  userText: { color: '#FFFFFF', fontSize: 15, lineHeight: 22 },
  typing: { flexDirection: 'row', gap: 5, alignItems: 'center', paddingVertical: 14 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  meta: { fontSize: 11, marginTop: 6, marginLeft: 4 },
  errorActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  inlineBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6, marginLeft: 4 },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1 },
  starterRow: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, gap: 8 },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    borderRadius: 22,
    borderWidth: 1,
    fontSize: 15,
  },
  sendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
