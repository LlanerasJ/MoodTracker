// screens/MeditationScreen.js
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Easing,
} from 'react-native';
import { Audio } from 'expo-av';
import { auth, db } from '../firebaseConfig';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';

/**
 * Audio assets:
 *  Place loopable files in /assets/audio/
 *   - calm_rain.mp3
 *   - forest_birds.mp3
 *   - ocean_waves.mp3
 */
const TRACKS = [
  { id: 'rain', title: 'Calm Rain', file: require('../assets/audio/calm_rain.mp3') },
  { id: 'forest', title: 'Forest Birds', file: require('../assets/audio/forest_birds.mp3') },
  { id: 'ocean', title: 'Ocean Waves', file: require('../assets/audio/ocean_waves.mp3') },
];

// Duration presets (minutes)
const DURATIONS_MIN = [3, 5, 10, 15];

// Breathing model (seconds)
const BREATH = { inhale: 4, hold: 2, exhale: 6 };

export default function MeditationScreen() {
  const uid = auth.currentUser?.uid || null;

  // UI state
  const [selectedTrackId, setSelectedTrackId] = useState(TRACKS[0]?.id ?? null);
  const [durationMin, setDurationMin] = useState(5);
  const [isRunning, setIsRunning] = useState(false);
  const [remaining, setRemaining] = useState(durationMin * 60);
  const [phase, setPhase] = useState('Ready'); // Ready | Inhale | Hold | Exhale | Done

  // Audio / animation refs
  const soundRef = useRef(null);
  const scale = useRef(new Animated.Value(1)).current;
  const loopRef = useRef(null);

  // Timer/phase refs
  const intervalRef = useRef(null);
  const phaseTimeoutRef = useRef(null);
  const runningRef = useRef(false); // avoid stale closures

  // Reset remaining when preset changes and not running
  useEffect(() => {
    if (!isRunning) setRemaining(durationMin * 60);
  }, [durationMin, isRunning]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopSession(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- Helpers ----------
  function buildBreathLoop() {
    // Use transform scale so we can useNativeDriver:true and loop smoothly.
    // Sequence: Inhale -> Hold -> Exhale
    return Animated.loop(
      Animated.sequence([
        Animated.timing(scale, {
          toValue: 1.10,
          duration: BREATH.inhale * 1000,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 1.10,
          duration: BREATH.hold * 1000,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 1.0,
          duration: BREATH.exhale * 1000,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
      { iterations: -1 }
    );
  }

  function startPhaseLabelLoop() {
    clearTimeout(phaseTimeoutRef.current);

    // One full cycle function, then re-schedule itself.
    const runCycle = () => {
      if (!runningRef.current) return;

      setPhase('Inhale');
      phaseTimeoutRef.current = setTimeout(() => {
        if (!runningRef.current) return;

        setPhase('Hold');
        phaseTimeoutRef.current = setTimeout(() => {
          if (!runningRef.current) return;

          setPhase('Exhale');
          phaseTimeoutRef.current = setTimeout(() => {
            // Repeat cycle
            if (runningRef.current) runCycle();
          }, BREATH.exhale * 1000);
        }, BREATH.hold * 1000);
      }, BREATH.inhale * 1000);
    };

    runCycle();
  }

  async function startAudio(trackId) {
    if (!trackId) return; // Silence
    try {
      const track = TRACKS.find(t => t.id === trackId);
      if (!track?.file) return;

      const { sound } = await Audio.Sound.createAsync(track.file, {
        isLooping: true,
        volume: 0.65,
      });
      soundRef.current = sound;
      await sound.playAsync();
    } catch (e) {
      console.warn('Audio error:', e?.message || e);
    }
  }

  async function stopAudio() {
    try {
      if (soundRef.current) {
        const s = soundRef.current;
        soundRef.current = null;
        await s.stopAsync().catch(() => {});
        await s.unloadAsync().catch(() => {});
      }
    } catch {}
  }

  function startTimer(totalSec) {
    clearInterval(intervalRef.current);
    const startTs = Date.now();

    intervalRef.current = setInterval(() => {
      if (!runningRef.current) return;

      const elapsed = Math.floor((Date.now() - startTs) / 1000);
      const left = totalSec - elapsed;
      setRemaining(Math.max(0, left));

      if (left <= 0) {
        stopSession(true);
      }
    }, 1000);
  }

  function stopTimer() {
    clearInterval(intervalRef.current);
    intervalRef.current = null;
  }

  // ---------- Session control ----------
  async function startSession() {
    if (isRunning) return;

    setRemaining(durationMin * 60);
    setIsRunning(true);
    runningRef.current = true;

    // Reset visual state
    setPhase('Inhale');
    scale.stopAnimation(() => scale.setValue(1.0));

    // Start looping animation
    loopRef.current = buildBreathLoop();
    loopRef.current.start();

    // Start phase label loop
    startPhaseLabelLoop();

    // Start audio
    await startAudio(selectedTrackId);

    // Start timer
    startTimer(durationMin * 60);
  }

  async function stopSession(completed = false) {
    // flags
    setIsRunning(false);
    runningRef.current = false;

    // animation
    if (loopRef.current) {
      loopRef.current.stop();
      loopRef.current = null;
    }
    scale.stopAnimation(() => scale.setValue(1));

    // timers
    stopTimer();
    clearTimeout(phaseTimeoutRef.current);

    // audio
    await stopAudio();

    // labels
    setPhase(completed ? 'Done' : 'Ready');

    // log
    if (completed && uid) {
      try {
        await addDoc(collection(db, 'users', uid, 'meditations'), {
          trackId: selectedTrackId ?? 'silence',
          durationSec: durationMin * 60,
          completedAt: serverTimestamp(),
          startedAt: serverTimestamp(), // simple; swap if you store real start
        });
      } catch (e) {
        console.warn('Failed to log meditation:', e?.message || e);
      }
    }
  }

  // ---------- UI helpers ----------
  const prettyTime = useMemo(() => {
    const m = Math.floor(remaining / 60).toString().padStart(2, '0');
    const s = Math.floor(remaining % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }, [remaining]);

  const currentTrackTitle =
    TRACKS.find(t => t.id === selectedTrackId)?.title || 'Silence';

  return (
    <SafeAreaView style={s.safeArea}>
      <View style={s.wrap}>
        <Text style={s.title}>Meditation</Text>

        {/* Track picker */}
        <View style={s.card}>
          <Text style={s.label}>Sound</Text>
          <View style={s.rowWrap}>
            {TRACKS.map(t => {
              const active = selectedTrackId === t.id;
              return (
                <TouchableOpacity
                  key={t.id}
                  onPress={() => !isRunning && setSelectedTrackId(t.id)}
                  style={[s.chip, active && s.chipActive, isRunning && { opacity: 0.5 }]}
                  disabled={isRunning}
                >
                  <Text style={[s.chipText, active && s.chipTextActive]}>{t.title}</Text>
                </TouchableOpacity>
              );
            })}
            {/* Silence option */}
            <TouchableOpacity
              onPress={() => !isRunning && setSelectedTrackId(null)}
              style={[s.chip, selectedTrackId == null && s.chipActive, isRunning && { opacity: 0.5 }]}
              disabled={isRunning}
            >
              <Text style={[s.chipText, selectedTrackId == null && s.chipTextActive]}>
                Silence
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Duration */}
        <View style={s.card}>
          <Text style={s.label}>Duration</Text>
          <View style={s.rowWrap}>
            {DURATIONS_MIN.map(min => {
              const active = durationMin === min;
              return (
                <TouchableOpacity
                  key={min}
                  onPress={() => !isRunning && setDurationMin(min)}
                  style={[s.chip, active && s.chipActive, isRunning && { opacity: 0.5 }]}
                  disabled={isRunning}
                >
                  <Text style={[s.chipText, active && s.chipTextActive]}>{min}m</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Breathing circle + Timer */}
        <View style={s.centerBox}>
          <Animated.View style={[s.breathCircle, { transform: [{ scale }] }]} />
          <Text style={s.phaseText}>{phase}</Text>
          <Text style={s.time}>{prettyTime}</Text>
          <Text style={s.subtle}>{currentTrackTitle}</Text>
        </View>

        {/* Controls */}
        <View style={s.controlsRow}>
          {!isRunning ? (
            <TouchableOpacity style={[s.btn, s.btnPrimary]} onPress={startSession}>
              <Text style={s.btnText}>Start</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={[s.btn, s.btnStop]} onPress={() => stopSession(false)}>
              <Text style={s.btnText}>Stop</Text>
            </TouchableOpacity>
          )}
        </View>

        <Text style={s.helper}>
          Tip: Breathe in gently as the circle grows, pause briefly, and exhale slowly as it shrinks.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#fff' },
  wrap: { flex: 1, padding: 20, gap: 12 },
  title: { fontSize: 28, fontWeight: '800', textAlign: 'center', marginBottom: 4, color: '#111' },

  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 12,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
    gap: 10,
  },
  label: { fontSize: 14, fontWeight: '700', color: '#111' },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },

  chip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: '#f3f4f6',
  },
  chipActive: { backgroundColor: '#c8f7c5' },
  chipText: { color: '#111', fontWeight: '600' },
  chipTextActive: { color: '#0b3d0e' },

  centerBox: { alignItems: 'center', justifyContent: 'center', paddingVertical: 10 },
  breathCircle: {
    width: 160,
    height: 160,
    borderRadius: 999,
    backgroundColor: '#E8F5E9',
    borderWidth: 2,
    borderColor: '#A5D6A7',
    marginBottom: 10,
  },
  phaseText: { fontSize: 16, fontWeight: '700', color: '#2e7d32', marginTop: 2 },
  time: { fontSize: 40, fontWeight: '800', marginTop: 2, color: '#111' },
  subtle: { fontSize: 12, color: '#6b7280', marginTop: 2 },

  controlsRow: { flexDirection: 'row', gap: 10, justifyContent: 'center', marginTop: 8 },
  btn: { paddingVertical: 12, paddingHorizontal: 18, borderRadius: 12, minWidth: 120, alignItems: 'center' },
  btnPrimary: { backgroundColor: '#4CAF50' },
  btnStop: { backgroundColor: '#ef4444' },
  btnText: { color: '#fff', fontWeight: '800' },

  helper: { textAlign: 'center', color: '#6b7280', marginTop: 4 },
});
