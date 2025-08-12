import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Alert } from 'react-native';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../firebaseConfig';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const login = async () => {
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      // App.js listener will switch to tabs automatically
    } catch (e) { Alert.alert('Login failed', e.message); }
  };

  const signup = async () => {
    try {
      await createUserWithEmailAndPassword(auth, email.trim(), password);
    } catch (e) { Alert.alert('Sign up failed', e.message); }
  };

  return (
    <View style={s.wrap}>
      <Text style={s.title}>Mood Tracker</Text>
      <TextInput
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        style={s.input}
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        placeholder="Password"
        secureTextEntry
        style={s.input}
        value={password}
        onChangeText={setPassword}
      />
      <Pressable style={s.btn} onPress={login}><Text style={s.btnText}>Log In</Text></Pressable>
      <Pressable style={[s.btn, s.btnGhost]} onPress={signup}><Text style={s.btnGhostText}>Create Account</Text></Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 28, fontWeight: '800', textAlign: 'center', marginBottom: 8 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 12, padding: 12 },
  btn: { backgroundColor: '#4CAF50', padding: 14, borderRadius: 12, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700' },
  btnGhost: { backgroundColor: '#f3f4f6' },
  btnGhostText: { color: '#111' },
});
