import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  SafeAreaView, ScrollView, View, Text, StyleSheet,
  TouchableOpacity, RefreshControl, Modal, TextInput,
  Animated, Alert, Image, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import useUserMoods from '../hooks/useUserMoods';

import { auth, db, storage } from '../firebaseConfig';
import {
  collection, deleteDoc, doc, updateDoc,
  onSnapshot, orderBy, query,
} from 'firebase/firestore';
import { ref, deleteObject } from 'firebase/storage';

const moods = ['😄', '😊', '😐', '😢', '😡'];

export default function JournalScreen() {
  const [entries, setEntries] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState(null); // {id,mood,note,date}
  const [search, setSearch] = useState('');
  const [activeMoods, setActiveMoods] = useState([]); // array of selected emoji
  const uid = auth.currentUser?.uid || null;
  const { moods } = useUserMoods();
  
  // helper – turns either a string mood or an object mood into an emoji string
  const moodEmoji = (m) => (typeof m === 'string' ? m : m?.emoji ?? '');

  // edit modal backdrop
  const editBackdrop = useRef(new Animated.Value(0)).current;

  // image viewer state + animation
  const [viewerUrl, setViewerUrl] = useState(null);
  const viewerBackdrop = useRef(new Animated.Value(0)).current;
  const viewerScale = useRef(new Animated.Value(0.9)).current;

  useFocusEffect(
    useCallback(() => {
      if (!uid) { setEntries([]); return; }
      const q = query(collection(db, 'users', uid, 'entries'), orderBy('date', 'desc'));
      const unsub = onSnapshot(q,
        (snap) => setEntries(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
        (err) => console.warn('Journal subscription error', err)
      );
      return unsub;
    }, [uid])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 400);
  }, []);

  const deleteEntry = async (id, photoPath) => {
    if (!uid) return;
    try {
      await deleteDoc(doc(db, 'users', uid, 'entries', id));
      if (photoPath) {
        try { await deleteObject(ref(storage, photoPath)); } catch {}
      }
    } catch (err) {
      console.error('Failed to delete entry', err);
      Alert.alert('Delete failed', 'Could not delete from the cloud.');
    }
  };

  const openEdit = (item) => {
    setEditing({ ...item });
    Animated.timing(editBackdrop, { toValue: 1, duration: 200, useNativeDriver: true }).start();
  };
  const closeEdit = () => {
    Animated.timing(editBackdrop, { toValue: 0, duration: 200, useNativeDriver: true })
      .start(() => setEditing(null));
  };
  const saveEdit = async () => {
    if (!editing || !uid) return;
    try {
      await updateDoc(doc(db, 'users', uid, 'entries', editing.id), {
        mood: editing.mood,
        note: editing.note,
        date: editing.date,
      });
      closeEdit();
    } catch (e) {
      console.warn('Cloud update failed', e);
      Alert.alert('Update failed', 'Could not save changes to the cloud.');
    }
  };

  // full-image viewer controls
  const openViewer = (url) => {
    if (!url) return;
    setViewerUrl(url);
    viewerBackdrop.setValue(0);
    viewerScale.setValue(0.9);
    Animated.parallel([
      Animated.timing(viewerBackdrop, { toValue: 1, duration: 160, useNativeDriver: true }),
      Animated.spring(viewerScale, { toValue: 1, useNativeDriver: true, friction: 7 })
    ]).start();
  };
  const closeViewer = () => {
    Animated.parallel([
      Animated.timing(viewerBackdrop, { toValue: 0, duration: 140, useNativeDriver: true }),
      Animated.timing(viewerScale, { toValue: 0.9, duration: 140, useNativeDriver: true })
    ]).start(() => setViewerUrl(null));
  };

  const formatGroupDate = (isoDate) => {
    const entryDate = new Date(isoDate);
    const today = new Date();
       const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const sameDay = (d1, d2) =>
      d1.getFullYear() === d2.getFullYear() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getDate() === d2.getDate();
    if (sameDay(entryDate, today)) return 'Today';
    if (sameDay(entryDate, yesterday)) return 'Yesterday';
    return entryDate.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  };

  const filteredEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter(e => {
      const moodPass = activeMoods.length === 0 || activeMoods.includes(e.mood);
      const text = (e.note || '').toLowerCase();
      const searchPass = q.length === 0 || text.includes(q);
      return moodPass && searchPass;
    });
  }, [entries, search, activeMoods]);

  const groupedArray = useMemo(() => {
    const groups = filteredEntries.reduce((acc, entry) => {
      const key = entry?.date ? formatGroupDate(entry.date) : 'Other';
      if (!acc[key]) acc[key] = [];
      acc[key].push(entry);
      return acc;
    }, {});
    Object.keys(groups).forEach(k =>
      groups[k].sort((a, b) => new Date(b.date) - new Date(a.date))
    );
    const keys = Object.keys(groups).sort((a, b) => {
      const order = { Today: 2, Yesterday: 1 };
      const aScore = order[a] ?? 0, bScore = order[b] ?? 0;
      if (aScore !== bScore) return bScore - aScore;
      const aDate = a === 'Today' || a === 'Yesterday' ? new Date() : new Date(a);
      const bDate = b === 'Today' || b === 'Yesterday' ? new Date() : new Date(b);
      return bDate - aDate;
    });
    return keys.map(k => [k, groups[k]]);
  }, [filteredEntries]);

  const toggleMood = (m) => {
    setActiveMoods((prev) =>
      prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]
    );
  };
  const clearFilters = () => {
    setActiveMoods([]);
    setSearch('');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.container}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.header}>Entries</Text>

        {/* Filters */}
        <View style={styles.filtersCard}>
          <TextInput
            placeholder="Search notes..."
            value={search}
            onChangeText={setSearch}
            style={styles.searchInput}
          />
          <View style={styles.chipsRow}>
            {moods.map((m) => {
              const emoji = moodEmoji(m);
              const active = activeMoods.includes(emoji);
              return (
                <TouchableOpacity
                  key={emoji}
                  onPress={() =>
                    setActiveMoods((prev) =>
                      prev.includes(emoji) ? prev.filter((x) => x !== emoji) : [...prev, emoji]
                    )
                  }
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{emoji}</Text>
                </TouchableOpacity>
              );
            })}
            {(activeMoods.length > 0 || search.length > 0) && (
              <TouchableOpacity onPress={clearFilters} style={[styles.chip, styles.clearChip]}>
                <Ionicons name="close-circle" size={16} color="#111" />
                <Text style={[styles.chipText, { marginLeft: 4 }]}>Clear</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Grouped list */}
        {groupedArray.map(([groupTitle, items]) => (
          <View key={groupTitle}>
            <Text style={styles.groupTitle}>{groupTitle}</Text>
            {items.map((item) => (
              <View key={item.id} style={styles.entryRow}>
                {/* LEFT: tap to edit */}
                <TouchableOpacity
                  style={styles.entryContent}
                  onPress={() => openEdit(item)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.entryText}>{item.mood} {item.note}</Text>
                </TouchableOpacity>

                {/* MIDDLE: tap ONLY image to view */}
                {item.photoURL ? (
                  <TouchableOpacity
                    onPress={() => openViewer(item.photoURL)}
                    activeOpacity={0.9}
                    style={styles.thumbWrap}
                  >
                    <Image source={{ uri: item.photoURL }} style={styles.thumb} />
                  </TouchableOpacity>
                ) : null}

                {/* RIGHT: delete */}
                <TouchableOpacity
                  onPress={() => deleteEntry(item.id, item.photoPath)}
                  style={styles.trashIcon}
                >
                  <Ionicons name="trash" size={20} color="white" />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        ))}

        {groupedArray.length === 0 && (
          <View style={{ alignItems: 'center', marginTop: 24 }}>
            <Text style={{ color: '#666' }}>No entries match your filters.</Text>
          </View>
        )}
      </ScrollView>

      {/* Edit Modal */}
      <Modal visible={!!editing} animationType="none" transparent onRequestClose={closeEdit}>
        <Animated.View style={[styles.modalBackdrop, { opacity: editBackdrop }]}>

          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}
          >
            <ScrollView
              contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center' }}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.modalCard}>
                <Text style={styles.modalTitle}>Edit Entry</Text>

                <View style={styles.moodRow}>
                  {moods.map((m) => {
                    const emoji = moodEmoji(m);
                    return (
                      <TouchableOpacity
                        key={emoji}
                        onPress={() => setEditing((prev) => ({ ...prev, mood: emoji }))}
                        style={[styles.moodButton, editing?.mood === emoji && styles.moodSelected]}
                      >
                        <Text style={{ fontSize: 28 }}>{emoji}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <TextInput
                  placeholder="Update your note…"
                  value={editing?.note ?? ''}
                  onChangeText={(t) => setEditing(prev => ({ ...prev, note: t }))}
                  style={styles.input}
                  multiline
                />

                <View style={styles.modalActions}>
                  <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={closeEdit}>
                    <Text style={[styles.btnText, { color: '#333' }]}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={saveEdit}>
                    <Text style={styles.btnText}>Save</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </Animated.View>
      </Modal>


      {/* Fullscreen Image Viewer */}
      <Modal visible={!!viewerUrl} animationType="none" transparent onRequestClose={closeViewer}>
        <Animated.View style={[styles.viewerBackdrop, { opacity: viewerBackdrop }]}>
          <TouchableOpacity style={{ flex: 1, width: '100%' }} activeOpacity={1} onPress={closeViewer}>
            <Animated.Image
              source={{ uri: viewerUrl ?? undefined }}
              resizeMode="contain"
              style={{
                width: '92%',
                height: '85%',
                alignSelf: 'center',
                transform: [{ scale: viewerScale }],
                borderRadius: 12,
              }}
            />
          </TouchableOpacity>
        </Animated.View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#fff' },
  container: { padding: 20, backgroundColor: '#fff' },
  header: { fontSize: 28, fontWeight: 'bold', marginBottom: 12, textAlign: 'center', color: '#222' },

  // Filters
  filtersCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  searchInput: {
    borderColor: '#e5e7eb',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 10,
  },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    backgroundColor: '#f3f4f6',
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  chipActive: { backgroundColor: '#c8f7c5' },
  chipText: { fontSize: 14, color: '#111' },
  chipTextActive: { fontWeight: '700' },
  clearChip: { flexDirection: 'row', alignItems: 'center' },

  groupTitle: { fontSize: 18, fontWeight: 'bold', marginTop: 16, marginBottom: 8, color: '#444' },

  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0f0f0',
    padding: 12,
    borderRadius: 10,
    marginBottom: 10,
  },
  entryContent: { flex: 1, paddingRight: 10 }, // tap area for edit
  entryText: { fontSize: 16, color: '#333' },
  thumbWrap: { marginRight: 10 },
  thumb: { width: 60, height: 60, borderRadius: 8, marginTop: 6 },
  trashIcon: {
    backgroundColor: '#FF4C4C',
    padding: 10,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // edit modal
  modalBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.25)',
    justifyContent: 'center', alignItems: 'center', padding: 20,
  },
  modalCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 16, width: '85%',
    shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10, elevation: 5,
  },
  modalTitle: { fontSize: 20, fontWeight: 'bold', marginBottom: 12, textAlign: 'center' },
  moodRow: { flexDirection: 'row', justifyContent: 'center', marginBottom: 10, flexWrap: 'wrap' },
  moodButton: { padding: 8, borderRadius: 10, backgroundColor: '#eee', marginHorizontal: 6, marginVertical: 4 },
  moodSelected: { backgroundColor: '#c8f7c5' },
  input: { borderColor: '#ccc', borderWidth: 1, borderRadius: 8, padding: 10, minHeight: 60, textAlignVertical: 'top' },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12, gap: 10 },
  btn: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10 },
  btnPrimary: { backgroundColor: '#4CAF50' },
  btnGhost: { backgroundColor: '#eee' },
  btnText: { color: 'white', fontWeight: '600' },

  // viewer
  viewerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
