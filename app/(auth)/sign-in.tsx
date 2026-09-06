import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Body, Button, Caption, Card, Screen, Title } from '../../src/components/ui';
import { authClient } from '../../src/lib/auth-client';
import { config } from '../../src/lib/config';
import { colors, spacing } from '../../src/theme';

type Step = 'email' | 'otp';

export default function SignIn() {
  const [busy, setBusy] = useState<'google' | 'email' | null>(null);
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');

  const done = () => router.replace('/(app)');

  const google = async () => {
    setBusy('google');
    try {
      const { GoogleSignin, isSuccessResponse, statusCodes, isErrorWithCode } = await import('@react-native-google-signin/google-signin');
      GoogleSignin.configure({ webClientId: config.googleWebClientId, iosClientId: config.googleIosClientId });
      await GoogleSignin.hasPlayServices();
      const res = await GoogleSignin.signIn();
      if (!isSuccessResponse(res)) return;
      const idToken = res.data.idToken;
      if (!idToken) throw new Error('Google returned no ID token');
      const { error } = await authClient.signIn.social({ provider: 'google', idToken: { token: idToken } });
      if (error) throw new Error(error.message ?? 'Sign-in rejected');
      done();
      return;
      // eslint-disable-next-line no-unreachable
      void statusCodes; void isErrorWithCode;
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      if (!/cancel/i.test(msg)) Alert.alert('Google sign-in failed', msg);
    } finally {
      setBusy(null);
    }
  };

  const sendCode = async () => {
    const e = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return Alert.alert('Enter a valid email');
    setBusy('email');
    try {
      const { error } = await authClient.emailOtp.sendVerificationOtp({ email: e, type: 'sign-in' });
      if (error) throw new Error(error.message ?? 'Could not send code');
      setStep('otp');
    } catch (err) {
      Alert.alert('Could not send code', (err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const verify = async () => {
    setBusy('email');
    try {
      const { error } = await authClient.signIn.emailOtp({ email: email.trim().toLowerCase(), otp: otp.trim() });
      if (error) throw new Error(error.message ?? 'Invalid code');
      done();
    } catch (err) {
      Alert.alert('Sign-in failed', (err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.wrap}>
          <View style={styles.hero}>
            <Image source={require('../../assets/splash-icon.png')} style={styles.logo} />
            <Title style={{ textAlign: 'center' }}>BarlesChailey</Title>
            <Caption style={{ textAlign: 'center' }}>Rockville VFD · off-duty dispatch alerts</Caption>
          </View>
          <Card style={{ gap: spacing.md }}>
            {config.googleConfigured ? (
              <Button title="Continue with Google" onPress={google} loading={busy === 'google'} />
            ) : (
              <Caption>Google sign-in is not configured for this build yet. Use your email below.</Caption>
            )}
            {step === 'email' ? (
              <>
                <TextInput
                  style={styles.input}
                  placeholder="you@example.com"
                  placeholderTextColor={colors.textDim}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  value={email}
                  onChangeText={setEmail}
                  onSubmitEditing={sendCode}
                />
                <Button title="Email me a sign-in code" variant="secondary" onPress={sendCode} loading={busy === 'email'} />
              </>
            ) : (
              <>
                <Body>We sent a 6-digit code to {email.trim()}.</Body>
                <TextInput
                  style={styles.input}
                  placeholder="123456"
                  placeholderTextColor={colors.textDim}
                  keyboardType="number-pad"
                  textContentType="oneTimeCode"
                  value={otp}
                  onChangeText={setOtp}
                  onSubmitEditing={verify}
                  autoFocus
                />
                <Button title="Verify and sign in" onPress={verify} loading={busy === 'email'} disabled={otp.trim().length < 4} />
                <Button title="Use a different email" variant="ghost" onPress={() => { setStep('email'); setOtp(''); }} />
              </>
            )}
          </Card>
          <Caption style={{ textAlign: 'center', marginTop: spacing.lg }}>
            Access is limited to approved members. An admin will approve new accounts.
          </Caption>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.xl },
  hero: { alignItems: 'center', gap: spacing.sm },
  logo: { width: 96, height: 96, marginBottom: spacing.sm },
  input: {
    backgroundColor: colors.surfaceRaised, color: colors.text, borderRadius: 12, paddingHorizontal: spacing.lg, minHeight: 52, fontSize: 17,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
});
