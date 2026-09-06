import { router } from 'expo-router';
import { Body, Button, Caption, Card, Screen, Title } from '../../src/components/ui';
import { useMe } from '../../src/hooks/useMe';
import { signOutEverywhere } from '../../src/lib/auth-client';
import { spacing } from '../../src/theme';

export default function Pending() {
  const me = useMe();
  const revoked = me.data?.member.status === 'revoked';
  return (
    <Screen style={{ padding: spacing.xl, justifyContent: 'center', gap: spacing.lg }}>
      <Card style={{ gap: spacing.md }}>
        <Title>{revoked ? 'Access revoked' : 'Almost there'}</Title>
        <Body>
          {revoked
            ? 'Your membership has been revoked. Talk to an admin if you think this is a mistake.'
            : `You're signed in as ${me.data?.user.email ?? 'your account'}. An admin needs to approve you before you can see the board or receive alerts.`}
        </Body>
        <Caption>Ask the person who invited you to open Settings → Members and approve your email.</Caption>
        <Button title="Check again" variant="secondary" onPress={() => me.refetch().then((r) => r.data?.member.status === 'active' && router.replace('/(app)'))} loading={me.isFetching} />
        <Button title="Sign out" variant="ghost" onPress={() => signOutEverywhere().then(() => router.replace('/(auth)/sign-in'))} />
      </Card>
    </Screen>
  );
}
