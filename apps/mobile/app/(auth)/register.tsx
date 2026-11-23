import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { api, setAccessToken } from '../../src/lib/api/client';
import { setRefreshToken, setLastUserId } from '../../src/lib/storage/secure-store';
import { useAppStore } from '../../src/lib/state/app-store';
import { makeStyles } from '../../src/ui/theme/makeStyles';
import { useTheme } from '../../src/ui/theme';

interface RegisterApiResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    displayName: string;
  };
}

const useStyles = makeStyles((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.color.surface,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: theme.space[6] ?? 24,
  },
  header: {
    marginBottom: theme.space[6] ?? 24,
  },
  title: {
    fontSize: theme.typography.headlineMedium.fontSize,
    fontWeight: '800',
    color: theme.color.primary,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: theme.typography.bodyMedium.fontSize,
    color: theme.color.onSurfaceVariant,
    marginTop: theme.space[2] ?? 8,
  },
  errorBanner: {
    backgroundColor: theme.color.errorContainer,
    borderRadius: theme.radius.md,
    padding: theme.space[3] ?? 12,
    marginBottom: theme.space[4] ?? 16,
  },
  errorText: {
    color: theme.color.onErrorContainer,
    fontSize: theme.typography.bodyMedium.fontSize,
    fontWeight: '500',
  },
  form: {
    gap: theme.space[4] ?? 16,
  },
  inputGroup: {
    gap: theme.space[1] ?? 4,
  },
  label: {
    fontSize: theme.typography.caption.fontSize,
    fontWeight: '600',
    color: theme.color.onSurface,
  },
  input: {
    backgroundColor: theme.color.surfaceContainer,
    color: theme.color.onSurface,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space[4] ?? 16,
    paddingVertical: theme.space[3] ?? 12,
    fontSize: theme.typography.bodyLarge.fontSize,
    borderWidth: 1,
    borderColor: theme.color.outlineVariant,
    minHeight: 48,
  },
  submitButton: {
    backgroundColor: theme.color.primary,
    borderRadius: theme.radius.md,
    paddingVertical: theme.space[3] ?? 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: theme.space[2] ?? 8,
    minHeight: 48,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: theme.color.onPrimary,
    fontSize: theme.typography.bodyLarge.fontSize,
    fontWeight: '700',
  },
  footer: {
    marginTop: theme.space[6] ?? 24,
    alignItems: 'center',
  },
  linkText: {
    color: theme.color.primary,
    fontSize: theme.typography.bodyMedium.fontSize,
    fontWeight: '600',
    padding: theme.space[2] ?? 8,
    minHeight: 44,
  },
}));

export default function RegisterScreen(): React.JSX.Element {
  const styles = useStyles();
  const { theme } = useTheme();
  const router = useRouter();

  const detectedTimezone =
    typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' : 'UTC';

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [timezone, setTimezone] = useState(detectedTimezone);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const setUserId = useAppStore((state) => state.setUserId);
  const setOnline = useAppStore((state) => state.setOnline);

  const handleRegister = async () => {
    if (!email.trim() || !password) {
      setErrorMessage('Email and password are required');
      return;
    }
    if (password.length < 10) {
      setErrorMessage('Password must be at least 10 characters long');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const data = await api.post<RegisterApiResponse>(
        '/auth/register',
        {
          displayName: displayName.trim() || undefined,
          email: email.trim().toLowerCase(),
          password,
          timezone,
        },
        { skipAuth: true },
      );

      setAccessToken(data.accessToken);
      await setRefreshToken(data.refreshToken);
      await setLastUserId(data.user.id);
      setUserId(data.user.id);
      setOnline(true);

      router.replace('/(tabs)/schedule');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Registration failed';
      setErrorMessage(msg);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.title}>Create Account</Text>
          <Text style={styles.subtitle}>Join Rota to manage and view team shifts</Text>
        </View>

        {errorMessage && (
          <View style={styles.errorBanner} accessibilityRole="alert">
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        )}

        <View style={styles.form}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Your Name</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Dr. Alex Mercer"
              placeholderTextColor={theme.color.onSurfaceVariant}
              value={displayName}
              onChangeText={setDisplayName}
              accessibilityLabel="Full Name"
              editable={!isLoading}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Email Address</Text>
            <TextInput
              style={styles.input}
              placeholder="you@example.com"
              placeholderTextColor={theme.color.onSurfaceVariant}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              accessibilityLabel="Email Address"
              editable={!isLoading}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Password (10+ characters)</Text>
            <TextInput
              style={styles.input}
              placeholder="••••••••••"
              placeholderTextColor={theme.color.onSurfaceVariant}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              accessibilityLabel="Password"
              editable={!isLoading}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Timezone</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. America/New_York"
              placeholderTextColor={theme.color.onSurfaceVariant}
              value={timezone}
              onChangeText={setTimezone}
              autoCapitalize="none"
              accessibilityLabel="Timezone"
              editable={!isLoading}
            />
          </View>

          <TouchableOpacity
            style={[styles.submitButton, isLoading && styles.submitButtonDisabled]}
            onPress={() => void handleRegister()}
            disabled={isLoading}
            accessibilityRole="button"
            accessibilityLabel="Create Account"
          >
            {isLoading ? (
              <ActivityIndicator color={theme.color.onPrimary} />
            ) : (
              <Text style={styles.submitButtonText}>Create Account</Text>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.footer}>
          <TouchableOpacity
            onPress={() => router.push('/(auth)/login')}
            accessibilityRole="link"
            accessibilityLabel="Already have an account? Sign in"
          >
            <Text style={styles.linkText}>Already have an account? Sign in</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
