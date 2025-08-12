import { useEffect, useMemo, useState } from 'react';
import {
  SafeAreaView, View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert, Image, ScrollView, KeyboardAvoidingView, Platform
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Calendar } from 'react-native-calendars';
import useUserMoods from '../hooks/useUserMoods';

import { auth, db, storage } from '../firebaseConfig';
import {
  addDoc, collection, onSnapshot, orderBy, query, serverTimestamp,
  updateDoc, doc
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

/** --- Local quotes/affirmations (short + uplifting). Add more anytime. --- */
const QUOTES = [
  { t: "One small step today is still progress.", a: "Unknown" },
  { t: "You are doing better than you think.", a: "Unknown" },
  { t: "Breathe in calm. Breathe out tension.", a: "Affirmation" },
  { t: "Your feelings are valid.", a: "Reminder" },
  { t: "Be where your feet are.", a: "Unknown" },
  { t: "You’ve handled 100% of your hardest days.", a: "Unknown" },
  { t: "I choose to be kind to myself today.", a: "Affirmation" },
  { t: "Slow is smooth, smooth is fast.", a: "Unknown" },
  { t: "Rest is productive.", a: "Reminder" },
  { t: "I am grounded, calm, and capable.", a: "Affirmation" },
  { t: "Tiny habits create big change.", a: "Unknown" },
  { t: "The present moment is enough.", a: "Unknown" },
  { t: "I welcome joy in small ways.", a: "Affirmation" },
  { t: "Progress, not perfection.", a: "Mantra" },
  { t: "Today, I will meet myself with compassion.", a: "Affirmation" },
  { t: "Feel it. Name it. Let it pass.", a: "Reminder" },
  { t: "I’m allowed to take up space.", a: "Affirmation" },
  { t: "Gratitude turns what we have into enough.", a: "Unknown" },
  { t: "I am safe. I am loved. I am learning.", a: "Affirmation" },
  { t: "This moment is a fresh start.", a: "Unknown" },
];

const Q_CACHE_KEY = 'quoteOfTheDay_v1';

// Normalize any date to an ISO YYYY-MM-DD (UTC day)
const toIsoDay = (dt) => {
  const d = new Date(dt);
  const utc = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  return utc.toISOString().slice(0, 10);
};

export default function HomeScreen() {
  const [selectedMood, setSelectedMood] = useState(null);
  const [gratitude, setGratitude] = useState('');
  const [entries, setEntries] = useState([]);
  const [imageUri, setImageUri] = useState(null);

  const [quote, setQuote] = useState(null); // {t, a}
  const [selectedDate, setSelectedDate] = useState(toIsoDay(new Date()));
  const uid = auth.currentUser?.uid || null;
  const { moods } = useUserMoods(); // [{emoji, score, label}, ...]

  // --- Live entries subscription ---
  useEffect(() => {
    if (!uid) {
      setEntries([]);
      return;
    }
    const q = query(collection(db, 'users', uid, 'entries'), orderBy('date', 'desc'));
    const unsub = onSnapshot(
      q,
      snap => setEntries(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      err => console.warn('onSnapshot error', err)
    );
    return unsub;
  }, [uid]);

  // Map of YYYY-MM-DD -> emoji (latest entry of the day wins)
  const dayEmojiMap = useMemo(() => {
    const map = {};
    for (const e of entries) {
      if (!e?.date || !e?.mood) continue;
      const key = toIsoDay(e.date);
      if (!map[key]) map[key] = e.mood; // entries are desc; keep first
    }
    return map;
  }, [entries]);

  // --- Daily Quote logic (deterministic by date + uid) ---
  useEffect(() => {
    const loadQ = async () => {
      const isoDay = toIsoDay(new Date());
      try {
        const raw = await AsyncStorage.getItem(Q_CACHE_KEY);
        const cache = raw ? JSON.parse(raw) : {};
        if (cache[isoDay]) {
          setQuote(cache[isoDay]);
          return;
        }
      } catch {}

      // Seed with uid so each user can get their own rotation; fall back to plain date
      const seedBase = (uid || 'anon') + isoDay;
      let hash = 0;
      for (let i = 0; i < seedBase.length; i++) {
        hash = (hash * 31 + seedBase.charCodeAt(i)) >>> 0;
      }
      const qObj = QUOTES[hash % QUOTES.length];
      setQuote(qObj);

      try {
        const raw = await AsyncStorage.getItem(Q_CACHE_KEY);
        const cache = raw ? JSON.parse(raw) : {};
        cache[isoDay] = qObj;
        await AsyncStorage.setItem(Q_CACHE_KEY, JSON.stringify(cache));
      } catch {}
    };
    loadQ();
  }, [uid]);

  // --- image picking ---
  const onAttachPress = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Please allow photo access to attach images.');
        return;
      }
      const mediaTypes =
        (ImagePicker.MediaType && ImagePicker.MediaType.Images) ||
        ImagePicker.MediaTypeOptions.Images;

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes,
        quality: 0.85,
        allowsEditing: false,
      });

      if (result.canceled) return;
      const uri = result.assets?.[0]?.uri || result.uri;
      if (!uri) return Alert.alert('No image', 'Could not read selected image URI.');
      setImageUri(uri);
    } catch (err) {
      console.warn('attach error', err);
      Alert.alert('Attach error', String(err?.message || err));
    }
  };

  // --- Upload photo and save entry ---
  const saveEntry = async () => {
    if (!selectedMood && gratitude.trim() === '' && !imageUri) return;
    if (!uid) return Alert.alert('Sign in required');

    try {
      // store entry using the selected calendar day
      const docRef = await addDoc(collection(db, 'users', uid, 'entries'), {
        mood: selectedMood ?? null,
        note: gratitude,
        date: new Date(selectedDate + 'T12:00:00.000Z').toISOString(),
        createdAt: serverTimestamp(),
        photoURL: null,
        photoPath: null,
      });

      if (imageUri) {
        const blob = await (await fetch(imageUri)).blob();
        const path = `users/${uid}/entries/${docRef.id}.jpg`;
        const fileRef = ref(storage, path);
        await uploadBytes(fileRef, blob, { contentType: 'image/jpeg' });
        const url = await getDownloadURL(fileRef);
        await updateDoc(doc(db, 'users', uid, 'entries', docRef.id), {
          photoURL: url, photoPath: path,
        });
      }

      setSelectedMood(null);
      setGratitude('');
      setImageUri(null);
    } catch (e) {
      console.warn('Save failed', e);
      Alert.alert('Save failed', 'Could not save your entry.');
    }
  };

  // (Optional) dev helper
  const insertDummyData = async () => {
    if (!uid) return Alert.alert('Sign in required');
    const sample = moods.length ? moods.map(m => m.emoji) : ['😄','😊','😐','😢','😡'];
    const today = new Date();
    await Promise.all(
      Array.from({ length: 5 }).map((_, idx) => {
        const d = new Date(today); d.setDate(today.getDate() - idx);
        return addDoc(collection(db, 'users', uid, 'entries'), {
          mood: sample[Math.floor(Math.random() * sample.length)],
          note: '',
          date: d.toISOString(),
          createdAt: serverTimestamp(),
          photoURL: null,
          photoPath: null,
        });
      })
    );
    Alert.alert('Inserted 5 dummy entries');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Daily Quote Card */}
          {quote && (
            <View style={styles.quoteCard}>
              <Text style={styles.quoteText}>“{quote.t}”</Text>
              {!!quote.a && <Text style={styles.quoteAuthor}>— {quote.a}</Text>}
            </View>
          )}

          {/* Calendar with emojis */}
          <View style={styles.calendarCard}>
            <Calendar
              firstDay={1}
              onDayPress={(d) => {
                setSelectedDate(d.dateString);
                const m = dayEmojiMap[d.dateString];
                if (m) setSelectedMood(m);
              }}
              dayComponent={({ date, state }) => {
                const key = date?.dateString;
                const emoji = key ? dayEmojiMap[key] : null;
                const isSelected = key === selectedDate;
                return (
                  <View
                    style={[
                      styles.dayCell,
                      isSelected && styles.dayCellSelected,
                      state === 'disabled' && { opacity: 0.35 },
                    ]}
                  >
                    <Text style={[styles.dayNum, isSelected && { color: 'white' }]}>
                      {date?.day}
                    </Text>
                    {emoji ? (
                      <Text style={[styles.dayEmoji, isSelected && { color: 'white' }]}>
                        {emoji}
                      </Text>
                    ) : null}
                  </View>
                );
              }}
              theme={{
                calendarBackground: 'transparent',
                textMonthFontWeight: '800',
                textMonthFontSize: 18,
                arrowColor: '#111',
                monthTextColor: '#111',
                todayTextColor: '#4CAF50',
              }}
              style={{ alignSelf: 'stretch' }}
            />
          </View>

          <Text style={styles.title}>How are you feeling?</Text>
          <View style={styles.moodRow}>
            {moods.map((m) => (
              <TouchableOpacity
                key={m.emoji}
                onPress={() => setSelectedMood(m.emoji)}
                style={[styles.moodButton, selectedMood === m.emoji && styles.selectedMood]}
              >
                <Text style={styles.moodText}>{m.emoji}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TextInput
            placeholder="Today I'm grateful for..."
            style={styles.input}
            value={gratitude}
            onChangeText={setGratitude}
          />

          {/* Image picker row */}
          <View style={styles.attachRow}>
            <TouchableOpacity onPress={onAttachPress} style={styles.attachBtn}>
              <Text style={styles.attachText}>{imageUri ? 'Change Photo' : 'Attach Photo'}</Text>
            </TouchableOpacity>
            {imageUri && <Image source={{ uri: imageUri }} style={styles.thumb} />}
          </View>

          <TouchableOpacity style={styles.saveButton} onPress={saveEntry}>
            <Text style={styles.saveButtonText}>Save</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.debugButton} onPress={insertDummyData}>
            <Text style={styles.debugButtonText}>Insert Dummy Data</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#fff' },
  container: {
    padding: 20,
    paddingBottom: 40, // extra space so last buttons aren’t hidden
    rowGap: 8,
  },
  title: { fontSize: 24, fontWeight: '800', marginBottom: 10, textAlign: 'center' },

  // Quote card
  quoteCard: {
    backgroundColor: '#F1F5FF',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  quoteText: { fontSize: 16, color: '#1f2937' },
  quoteAuthor: { marginTop: 6, fontSize: 13, color: '#6b7280', textAlign: 'right' },

  // Calendar styles
  calendarCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 8,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  dayCell: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCellSelected: { backgroundColor: '#4CAF50' },
  dayNum: { fontSize: 12, color: '#111', fontWeight: '600' },
  dayEmoji: { fontSize: 12, marginTop: 1 },

  moodRow: { flexDirection: 'row', justifyContent: 'center', marginBottom: 10, gap: 10 },
  moodButton: { padding: 12, borderRadius: 12, backgroundColor: '#eee' },
  selectedMood: { backgroundColor: '#c8f7c5' },
  moodText: { fontSize: 24 },

  input: { borderColor: '#ccc', borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 10 },
  attachRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end',
    marginBottom: 10, gap: 10
  },
  attachBtn: { backgroundColor: '#f3f4f6', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10 },
  attachText: { fontWeight: '600', color: '#111' },
  thumb: { width: 44, height: 44, borderRadius: 8 },

  saveButton: { backgroundColor: '#4CAF50', padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 4, marginBottom: 20 },
  saveButtonText: { color: 'white', fontSize: 16, fontWeight: 'bold' },
  debugButton: { backgroundColor: '#2196F3', padding: 12, borderRadius: 10, alignItems: 'center', marginTop: 6 },
  debugButtonText: { color: 'white', fontWeight: 'bold' },
});
