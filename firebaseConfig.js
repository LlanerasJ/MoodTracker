// firebaseConfig.js
import { initializeApp, getApps, getApp } from 'firebase/app';
import { initializeAuth, getAuth, getReactNativePersistence } from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: "AIzaSyAXRzET3H14-WM_PLbjPb0Q56JLwlZ-uvg",
  authDomain: "mood-tracker-92aa9.firebaseapp.com",
  projectId: "mood-tracker-92aa9",
  storageBucket: "mood-tracker-92aa9.firebasestorage.app",
  messagingSenderId: "958171150164",
  appId: "1:958171150164:web:6225aeb4a1f1976bd8bac1",
  measurementId: "G-85G9NMH39R"
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

let auth;
try {
  auth = initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
} catch { auth = getAuth(app); }

export const db = getFirestore(app);
export const storage = getStorage(app);
export { auth, app };