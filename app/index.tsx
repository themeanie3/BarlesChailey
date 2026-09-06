import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { authClient } from '../src/lib/auth-client';
import { colors } from '../src/theme';

/** Entry: route to sign-in or the app based on the cached Neon Auth session. */
export default function Index() {
  const { data: session, isPending } = authClient.useSession();
  if (isPending) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  return <Redirect href={session ? '/(app)' : '/(auth)/sign-in'} />;
}
