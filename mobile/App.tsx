import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, StatusBar } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import LoginScreen from './src/screens/LoginScreen';
import NewTicketScreen from './src/screens/NewTicketScreen';
import { getToken } from './src/lib/auth';
import { setUnauthorizedHandler } from './src/lib/api';

export default function App() {
  const [checkingSession, setCheckingSession] = useState(true);
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    getToken()
      .then((token) => setLoggedIn(Boolean(token)))
      .finally(() => setCheckingSession(false));
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setLoggedIn(false));
    return () => setUnauthorizedHandler(null);
  }, []);

  if (checkingSession) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        {loggedIn ? (
          <NewTicketScreen onLoggedOut={() => setLoggedIn(false)} />
        ) : (
          <LoginScreen onLoggedIn={() => setLoggedIn(true)} />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
