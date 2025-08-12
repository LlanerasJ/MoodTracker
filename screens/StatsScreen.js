import React, { useCallback, useEffect, useState } from 'react';
import {
  SafeAreaView,
  Text,
  StyleSheet,
  Dimensions,
  ScrollView,
  View,
} from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { useFocusEffect } from '@react-navigation/native';
import useUserMoods, { DEFAULT_MOODS } from '../hooks/useUserMoods';

import { auth, db } from '../firebaseConfig';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';

export default function StatsScreen() {
  const screenWidth = Dimensions.get('window').width;
  const screenHeight = Dimensions.get('window').height;

  const [chartData, setChartData] = useState(null);
  const [summaryText, setSummaryText] = useState('');
  const [meta, setMeta] = useState(null);
  const { moods, emojiToScore } = useUserMoods();

  const emojiMap = { 5: '😄', 4: '😊', 3: '😐', 2: '😢', 1: '😡' };

  const moodToValue = (emoji) => emojiToScore.get(emoji) ?? 3; // default mid if not found

  const valueToSummary = (avg) => {
    if (avg >= 4.5) return '😄 You’ve been feeling amazing this week!';
    if (avg >= 3.5) return '😊 You’ve had a mostly good week!';
    if (avg >= 2.5) return '😐 It’s been an okay week. Stay mindful.';
    if (avg >= 1.5) return '😢 This week’s been tough. Take care of yourself.';
    return '😡 It seems like a rough week. Try to take some time to relax.';
  };

  const buildFromEntries = (entries = []) => {
    // Group by ISO day (YYYY-MM-DD) for stable sorting regardless of locale
    const grouped = {};
    entries.forEach((entry) => {
      if (!entry?.date) return;
      const d = new Date(entry.date);
      const isoDay = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
        .toISOString()
        .slice(0, 10); // YYYY-MM-DD
      const v = moodToValue(entry.mood);
      if (v != null) {
        if (!grouped[isoDay]) grouped[isoDay] = [];
        grouped[isoDay].push(v);
      }
    });

    const sortedDays = Object.keys(grouped).sort((a, b) => new Date(a) - new Date(b));
    const last7 = sortedDays.slice(-7);

    const labels = last7.map((iso) => {
      const [y, m, d] = iso.split('-');
      return `${Number(m)}/${Number(d)}`; // e.g., 8/10
    });

    const data = last7.map((iso) => {
      const values = grouped[iso] || [];
      const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
      return Number.isFinite(avg) ? avg : 0;
    });

    if (!labels.length || !data.length || data.every((v) => v === 0)) {
      setChartData(null);
      setSummaryText('');
      setMeta(null);
      return;
    }

    // Summary sentence
    const avgMood = data.reduce((a, b) => a + b, 0) / data.length;
    setSummaryText(valueToSummary(avgMood));

    // Insights
    const counts = { '😄': 0, '😊': 0, '😐': 0, '😢': 0, '😡': 0 };
    data.forEach((v) => {
      const e = emojiMap[Math.round(v)];
      if (e) counts[e]++;
    });

    const bestIdx = data.indexOf(Math.max(...data));
    const worstIdx = data.indexOf(Math.min(...data));
    const best = { label: labels[bestIdx], value: data[bestIdx] };
    const worst = { label: labels[worstIdx], value: data[worstIdx] };
    const mostFrequentMood = Object.keys(counts).reduce((a, b) =>
      counts[a] > counts[b] ? a : b
    );

    // Streak (consecutive days with any entry)
    let streak = 0;
    for (let i = 0; i < 365; i++) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const iso = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
        .toISOString()
        .slice(0, 10);
      if (grouped[iso]) streak++;
      else break;
    }

    setMeta({ best, worst, mostFrequentMood, streak });
    setChartData({ labels, datasets: [{ data }] });
  };

  const scoreToEmoji = (score) => {
    const set = moods?.length ? moods : DEFAULT_MOODS;
    // find mood with nearest score
    let best = set[0];
    let diff = Math.abs(set[0].score - score);
    for (const m of set) {
      const d = Math.abs(m.score - score);
      if (d < diff) { diff = d; best = m; }
    }
    return best.emoji;
  };


  // Live Firestore subscription
  useFocusEffect(
    useCallback(() => {
      const uid = auth.currentUser?.uid;
      if (!uid) {
        setChartData(null);
        setSummaryText('');
        setMeta(null);
        return;
      }
      const q = query(collection(db, 'users', uid, 'entries'), orderBy('date', 'desc'));
      const unsub = onSnapshot(
        q,
        (snap) => {
          const remote = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          buildFromEntries(remote);
        },
        (err) => {
          console.warn('Stats subscription error', err);
          setChartData(null);
          setSummaryText('');
          setMeta(null);
        }
      );
      return unsub;
    }, [])
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Mood Over Time</Text>

        {chartData ? (
          <>
            <View style={styles.chartSummaryWrapper}>
              <LineChart
                data={chartData}
                width={screenWidth}
                height={screenHeight * 0.45}
                fromZero
                withDots
                withShadow
                withInnerLines
                withOuterLines={false}
                segments={2}
                formatYLabel={(value) => {
                  const rounded = Math.round(value);
                  if (rounded >= 5) return '😄';
                  if (rounded <= 1) return '😡';
                  return '';
                }}
                chartConfig={{
                  backgroundColor: '#fff',
                  backgroundGradientFrom: '#fff',
                  backgroundGradientTo: '#fff',
                  decimalPlaces: 0,
                  color: (o = 1) => `rgba(76,175,80,${o})`,
                  labelColor: (o = 1) => `rgba(0,0,0,${o})`,
                  propsForLabels: { fontSize: 12, fontWeight: 'bold' },
                  propsForDots: { r: '5', strokeWidth: '2', stroke: '#4CAF50' },
                }}
                bezier
                style={styles.chart}
              />

              <View style={styles.summaryContainer}>
                <Text style={styles.summaryText}>{summaryText}</Text>
              </View>
            </View>

            {meta && (
              <View style={styles.cardsRow}>
                <View style={styles.card}>
                  <Text style={styles.cardLabel}>Best day</Text>
                  <Text style={styles.cardValue}>{meta.best.label}</Text>
                  <Text style={styles.cardMood}>
                    <Text style={styles.cardMood}>{scoreToEmoji(meta.best.value)}</Text>
                  </Text>
                </View>
                <View style={styles.card}>
                  <Text style={styles.cardLabel}>Toughest day</Text>
                  <Text style={styles.cardValue}>{meta.worst.label}</Text>
                  <Text style={styles.cardMood}>
                    <Text style={styles.cardMood}>{scoreToEmoji(meta.best.value)}</Text>
                  </Text>
                </View>
              </View>
            )}

            {meta && (
              <View style={styles.chipsRow}>
                <View style={styles.chip}>
                  <Text style={styles.chipText}>Most frequent</Text>
                  <Text style={styles.chipEmoji}>{meta.mostFrequentMood}</Text>
                </View>
                <View className="chip" style={styles.chip}>
                  <Text style={styles.chipText}>Streak</Text>
                  <Text style={styles.chipEmoji}>{meta.streak}d</Text>
                </View>
              </View>
            )}
          </>
        ) : (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>
              Not enough data to show mood trends yet.
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#fff' },
  container: { padding: 15, paddingBottom: 40 },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 10,
    textAlign: 'center',
    color: '#333',
  },
  chartSummaryWrapper: { alignItems: 'center', marginBottom: 10 },
  chart: { borderRadius: 16, alignSelf: 'center', marginBottom: 6 },
  summaryContainer: {
    marginTop: 4,
    marginBottom: 50,
    padding: 16,
    backgroundColor: '#F1F8E9',
    borderRadius: 14,
    maxWidth: '90%',
    alignSelf: 'center',
  },
  summaryText: { fontSize: 16, textAlign: 'center', color: '#2e2e2e' },
  emptyState: { marginTop: 50, alignItems: 'center' },
  emptyText: { fontSize: 16, color: '#999' },
  cardsRow: { flexDirection: 'row', gap: 12, marginTop: 14 },
  card: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 12,
    shadowColor: '#000',
    shadowOpacity: 0.10,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
    alignItems: 'center',
  },
  cardLabel: { fontSize: 12, color: '#6b7280', marginBottom: 6 },
  cardValue: { fontSize: 16, fontWeight: '600', color: '#111827' },
  cardMood: { fontSize: 22, marginTop: 6 },
  chipsRow: { flexDirection: 'row', gap: 10, marginTop: 12, flexWrap: 'wrap' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f3f4f6',
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  chipText: { fontSize: 13, color: '#374151', marginRight: 6 },
  chipEmoji: { fontSize: 16 },
});
