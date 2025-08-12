// screens/SettingsScreen.js
import React, { useEffect, useState } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  Pressable,
  StyleSheet,
  Platform,
  Alert,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import DateTimePicker from '@react-native-community/datetimepicker';
import useUserMoods from '../hooks/useUserMoods';

import {
  signOut,
  deleteUser,
  EmailAuthProvider,
  reauthenticateWithCredential,
} from 'firebase/auth';
import { auth, db, storage } from '../firebaseConfig';
import {
  collection,
  getDocs,
  writeBatch,
  deleteDoc,
  doc,
} from 'firebase/firestore';
import { ref, deleteObject, listAll } from 'firebase/storage';

const STORAGE_KEY = 'reminderTime';
const STORAGE_NOTIF_ID = 'reminderNotifId';

export default function SettingsScreen() {
  const [time, setTime] = useState(new Date());
  const [showPicker, setShowPicker] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const { moods, addMood, removeMood } = useUserMoods();
  const [newEmoji, setNewEmoji] = useState('');
  const [newScore, setNewScore] = useState('');


  // Delete all user data in Firestore, then optionally delete the user
  const purgeUserData = async (uid) => {
    // 1) Try to delete all files under users/{uid}/entries
    try {
      const folderRef = ref(storage, `users/${uid}/entries`);
      const { items } = await listAll(folderRef); // list files in the folder
      await Promise.all(
        items.map((itemRef) =>
          deleteObject(itemRef).catch((e) => {
            console.warn('deleteObject failed (ignored):', itemRef.fullPath, e?.code);
            return null;
          })
        )
      );
    } catch (e) {
      // listAll fails if the folder doesn't exist—safe to ignore
      console.warn('listAll failed (safe to ignore if empty):', e?.code);
    }

    // 2) Also delete any file paths referenced on docs (belt & suspenders)
    const entriesRef = collection(db, 'users', uid, 'entries');
    const snap = await getDocs(entriesRef);
    await Promise.all(
      snap.docs.map(async (d) => {
        const { photoPath } = d.data() || {};
        if (photoPath) {
          try {
            await deleteObject(ref(storage, photoPath));
          } catch (e) {
            console.warn('deleteObject by photoPath failed (ignored):', photoPath, e?.code);
          }
        }
      })
    );

    // 3) Remove the entry docs
    const batch = writeBatch(db);
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();

    // 4) Remove any profile doc at users/{uid} if you have one
    try { await deleteDoc(doc(db, 'users', uid)); } catch {}
  };


  useEffect(() => {
    (async () => {
      // load saved reminder time
      const saved = await AsyncStorage.getItem(STORAGE_KEY);
      if (saved) {
        const d = new Date(saved);
        if (!isNaN(d)) setTime(d);
      }
      // check existing scheduled id
      const id = await AsyncStorage.getItem(STORAGE_NOTIF_ID);
      setEnabled(!!id);
    })();
  }, []);

  const requestPerms = async () => {
    if (!Device.isDevice) {
      Alert.alert('Notifications require a physical device');
      return false;
    }
    const { status } = await Notifications.requestPermissionsAsync();
    return status === 'granted';
  };

  const scheduleDaily = async () => {
    const ok = await requestPerms();
    if (!ok) return;

    // cancel previous
    const existingId = await AsyncStorage.getItem(STORAGE_NOTIF_ID);
    if (existingId) {
      try {
        await Notifications.cancelScheduledNotificationAsync(existingId);
      } catch {}
    }

    const hours = time.getHours();
    const minutes = time.getMinutes();

    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: '📝 Mood check-in',
        body: 'How are you feeling today?',
      },
      trigger: {
        hour: hours,
        minute: minutes,
        repeats: true,
      },
    });

    await AsyncStorage.setItem(STORAGE_NOTIF_ID, id);
    await AsyncStorage.setItem(STORAGE_KEY, time.toISOString());
    setEnabled(true);
    Alert.alert(
      'Reminder set',
      `Daily at ${hours.toString().padStart(2, '0')}:${minutes
        .toString()
        .padStart(2, '0')}`
    );
  };

  const disableDaily = async () => {
    const id = await AsyncStorage.getItem(STORAGE_NOTIF_ID);
    if (id) {
      try {
        await Notifications.cancelScheduledNotificationAsync(id);
      } catch {}
    }
    await AsyncStorage.removeItem(STORAGE_NOTIF_ID);
    setEnabled(false);
    Alert.alert('Reminder disabled');
  };

  const handleDeleteAccount = async () => {
    const user = auth.currentUser;
    if (!user) return;

    try {
      setBusy(true);
      // 1) delete Firestore data
      await purgeUserData(user.uid);

      // 2) delete auth user
      await deleteUser(user); // onAuthStateChanged -> null will take you to Login
    } catch (err) {
      // Firebase requires a recent login for destructive actions
      if (err?.code === 'auth/requires-recent-login') {
        // Ask for password to reauthenticate (works on iOS/Android; Alert.prompt is iOS-only)
        // For cross-platform: create a small modal to capture password. Here we show iOS prompt fallback.
        if (Platform.OS === 'ios') {
          Alert.prompt(
            'Re-enter password',
            'For security, please confirm your password to delete your account.',
            async (password) => {
              if (!password) return;
              try {
                const cred = EmailAuthProvider.credential(user.email, password);
                await reauthenticateWithCredential(user, cred);
                await purgeUserData(user.uid);
                await deleteUser(user);
              } catch (e2) {
                Alert.alert('Could not delete account', e2.message);
              }
            },
            'secure-text'
          );
        } else {
          Alert.alert(
            'Re-authentication required',
            'Please log out and log back in, then try deleting again.'
          );
        }
      } else {
        Alert.alert('Could not delete account', err.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = () => {
    Alert.alert(
      'Delete account?',
      'This permanently removes your account and all entries.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: handleDeleteAccount },
      ]
    );
  };

  return (
    <SafeAreaView style={s.safeArea}>
      <View style={s.wrap}>
        <Text style={s.h1}>Settings</Text>

        {/* Daily Reminder */}
        <View style={s.card}>
          <Text style={s.label}>Daily reminder</Text>

          <Pressable onPress={() => setShowPicker(true)} style={s.timeBtn}>
            <Text style={s.timeText}>
              {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>
          </Pressable>

          {showPicker && (
            <DateTimePicker
              value={time}
              mode="time"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(_, selected) => {
                setShowPicker(false);
                if (selected) setTime(selected);
              }}
            />
          )}

          <View style={s.row}>
            <Pressable
              style={[s.btn, enabled ? s.btnGhost : s.btnPrimary]}
              onPress={enabled ? disableDaily : scheduleDaily}
            >
              <Text style={[s.btnText, enabled ? { color: '#111' } : null]}>
                {enabled ? 'Disable' : 'Enable'}
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Custom moods */}
        <View style={s.card}>
          <Text style={s.label}>Custom moods</Text>

          {/* List current moods */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {moods.map(m => (
              <View key={m.emoji} style={s.moodPill}>
                <Text style={{ fontSize: 18 }}>{m.emoji}</Text>
                <Text style={{ fontSize: 12, color: '#6b7280', marginLeft: 6 }}>
                  {m.score}
                </Text>
                <Pressable style={s.moodRemove} onPress={() => removeMood(m.emoji)}>
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14, lineHeight: 15, textAlign: 'center' }}>×</Text>
                </Pressable>
              </View>
            ))}
          </View>

          {/* Add mood row */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TextInput
              placeholder="Emoji"
              value={newEmoji}
              onChangeText={setNewEmoji}
              maxLength={2}
              style={[s.input, { width: 70, textAlign: 'center' }]}
            />
            <TextInput
              placeholder="Score 1-5"
              value={newScore}
              onChangeText={setNewScore}
              keyboardType="number-pad"
              style={[s.input, { width: 110 }]}
            />
            <Pressable
              style={[s.btn, s.btnPrimary]}
              onPress={() => {
                const e = (newEmoji || '').trim();
                const sc = Math.max(1, Math.min(5, parseInt(newScore || '3', 10)));
                if (!e) return;
                addMood(e, sc);
                setNewEmoji('');
                setNewScore('');
              }}
            >
              <Text style={s.btnText}>Add</Text>
            </Pressable>
          </View>
          <Text style={{ fontSize: 12, color: '#6b7280' }}>
            Tip: score maps to how “positive” the mood is (5 = best).
          </Text>
        </View>
        

        {/* Account (pushed to bottom) */}
        <View style={[s.card, { marginTop: 'auto' }]}>
          <Text style={s.label}>Account</Text>

          <Pressable
            style={[s.btn, { backgroundColor: '#ef4444' }]}
            onPress={() => signOut(auth)}
          >
            <Text style={s.btnText}>Log Out</Text>
          </Pressable>

          <Pressable
            onPress={confirmDelete}
            style={{
              backgroundColor: '#ef4444',
              padding: 14,
              borderRadius: 12,
              alignItems: 'center',
              opacity: busy ? 0.6 : 1,
              marginTop: 8,
            }}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={{ color: '#fff', fontWeight: '700' }}>
                Permanently Delete Account
              </Text>
            )}
          </Pressable>

          <Text style={{ fontSize: 12, color: '#666', textAlign: 'center', marginTop: 6 }}>
            This removes your entries and account. This action cannot be undone.
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#fff' },
  wrap: { flex: 1, padding: 20, gap: 16 },
  h1: { fontSize: 24, fontWeight: '800', textAlign: 'center', marginBottom: 8 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
    gap: 12,
  },
  label: { fontSize: 16, fontWeight: '600', color: '#111' },
  timeBtn: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignSelf: 'flex-start',
    borderRadius: 10,
    backgroundColor: '#f3f4f6',
  },
  timeText: { fontSize: 18, fontWeight: '600' },
  row: { flexDirection: 'row', gap: 10 },
  btn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  btnPrimary: { backgroundColor: '#4CAF50' },
  btnGhost: { backgroundColor: '#f3f4f6' },
  btnText: { color: '#fff', fontWeight: '700' },
  moodPill: {
  flexDirection: 'row',
  alignItems: 'center',
  backgroundColor: '#f3f4f6',
  paddingVertical: 6,
  paddingHorizontal: 10,
  borderRadius: 999,
  position: 'relative'
  },
  moodRemove: {
    marginLeft: 8,
    backgroundColor: '#ef4444',
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center'
  },
  input: {
    borderColor: '#e5e7eb',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
});
