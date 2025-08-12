import { useEffect, useMemo, useState } from 'react';
import { auth, db } from '../firebaseConfig';
import { doc, onSnapshot, setDoc, updateDoc } from 'firebase/firestore';

export const DEFAULT_MOODS = [
  { emoji: '😄', score: 5, label: 'Great' },
  { emoji: '😊', score: 4, label: 'Good' },
  { emoji: '😐', score: 3, label: 'Okay' },
  { emoji: '😢', score: 2, label: 'Sad' },
  { emoji: '😡', score: 1, label: 'Angry' },
];

export default function useUserMoods() {
  const uid = auth.currentUser?.uid || null;
  const [moods, setMoods] = useState(DEFAULT_MOODS);

  useEffect(() => {
    if (!uid) { setMoods(DEFAULT_MOODS); return; }
    const ref = doc(db, 'users', uid, 'settings', 'prefs');
    const unsub = onSnapshot(ref, snap => {
      const data = snap.data();
      if (data?.moods && Array.isArray(data.moods) && data.moods.length) {
        setMoods(data.moods);
      } else {
        setMoods(DEFAULT_MOODS);
      }
    });
    return unsub;
  }, [uid]);

  const emojiToScore = useMemo(() => {
    const map = new Map();
    moods.forEach(m => map.set(m.emoji, m.score));
    return map;
  }, [moods]);

  const saveMoods = async (next) => {
    if (!uid) return;
    const ref = doc(db, 'users', uid, 'settings', 'prefs');
    // create doc if missing
    await setDoc(ref, { moods: next }, { merge: true });
  };

  const addMood = async (emoji, score = 3, label = '') => {
    const next = [...moods, { emoji, score, label }];
    await saveMoods(next);
  };

  const removeMood = async (emoji) => {
    const next = moods.filter(m => m.emoji !== emoji);
    await saveMoods(next);
  };

  const updateMood = async (emoji, patch) => {
    const next = moods.map(m => m.emoji === emoji ? { ...m, ...patch } : m);
    await saveMoods(next);
  };

  return { moods, emojiToScore, addMood, removeMood, updateMood, saveMoods };
}
