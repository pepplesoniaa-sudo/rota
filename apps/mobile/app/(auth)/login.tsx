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

interface LoginApiResponse {
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
    gap: theme.space[3] ?? 12,
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

export default function LoginScreen(): React.JSX.Element {
  const styles = useStyles();
  const { theme } = useTheme();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const setUserId = useAppStore((state) => state.setUserId);
  const setOnline = useAppStore((state) => state.setOnline);

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      setErrorMessage('Please enter your email and password');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const data = await api.post<LoginApiResponse>(
        '/auth/login',
        {
          email: email.trim().toLowerCase(),
          password,
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
      const msg = err instanceof Error ? err.message : 'Login failed. Please check credentials.';
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
          <Text style={styles.title}>Rota</Text>
          <Text style={styles.subtitle}>Sign in to your shift scheduling workspace</Text>
        </View>

        {errorMessage && (
          <View style={styles.errorBanner} accessibilityRole="alert">
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        )}

        <View style={styles.form}>
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
            <Text style={styles.label}>Password</Text>
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

          <TouchableOpacity
            style={[styles.submitButton, isLoading && styles.submitButtonDisabled]}
            onPress={() => void handleLogin()}
            disabled={isLoading}
            accessibilityRole="button"
            accessibilityLabel="Sign In"
          >
            {isLoading ? (
              <ActivityIndicator color={theme.color.onPrimary} />
            ) : (
              <Text style={styles.submitButtonText}>Sign In</Text>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.footer}>
          <TouchableOpacity
            onPress={() => router.push('/(auth)/register')}
            accessibilityRole="link"
            accessibilityLabel="Don't have an account? Sign up"
          >
            <Text style={styles.linkText}>Don't have an account? Sign up</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => router.push('/(auth)/password-reset')}
            accessibilityRole="link"
            accessibilityLabel="Forgot your password?"
          >
            <Text style={styles.linkText}>Forgot your password?</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
