// screens/AuthLoadingScreen.js
import React, { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebaseConfig';

export default function AuthLoadingScreen({ navigation }) {
  useEffect(() => {
    if (!auth) {
      console.warn('Firebase auth is undefined — check firebaseConfig.js export');
      return;
    }
    const unsub = onAuthStateChanged(auth, (user) => {
      navigation.replace(user ? 'MainTabs' : 'Login');
    });
    return unsub;
  }, [navigation]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#4CAF50" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});
