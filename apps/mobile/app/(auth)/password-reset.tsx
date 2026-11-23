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
import { api } from '../../src/lib/api/client';
import { makeStyles } from '../../src/ui/theme/makeStyles';
import { useTheme } from '../../src/ui/theme';

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
  bannerSuccess: {
    backgroundColor: theme.color.successContainer,
    borderRadius: theme.radius.md,
    padding: theme.space[3] ?? 12,
    marginBottom: theme.space[4] ?? 16,
  },
  bannerSuccessText: {
    color: theme.color.onSuccessContainer,
    fontSize: theme.typography.bodyMedium.fontSize,
    fontWeight: '500',
  },
  bannerError: {
    backgroundColor: theme.color.errorContainer,
    borderRadius: theme.radius.md,
    padding: theme.space[3] ?? 12,
    marginBottom: theme.space[4] ?? 16,
  },
  bannerErrorText: {
    color: theme.color.onErrorContainer,
    fontSize: theme.typography.bodyMedium.fontSize,
    fontWeight: '500',
  },
  toggleRow: {
    flexDirection: 'row',
    marginBottom: theme.space[4] ?? 16,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.surfaceContainer,
    padding: 4,
  },
  toggleTab: {
    flex: 1,
    paddingVertical: theme.space[2] ?? 8,
    alignItems: 'center',
    borderRadius: theme.radius.sm,
  },
  toggleTabActive: {
    backgroundColor: theme.color.surface,
  },
  toggleTabText: {
    fontSize: theme.typography.bodyMedium.fontSize,
    color: theme.color.onSurfaceVariant,
    fontWeight: '600',
  },
  toggleTabTextActive: {
    color: theme.color.primary,
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

export default function PasswordResetScreen(): React.JSX.Element {
  const styles = useStyles();
  const { theme } = useTheme();
  const router = useRouter();

  const [mode, setMode] = useState<'request' | 'confirm'>('request');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleRequest = async () => {
    if (!email.trim()) {
      setErrorMessage('Please enter your email address');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      await api.post(
        '/auth/password-reset/request',
        { email: email.trim().toLowerCase() },
        { skipAuth: true },
      );
      setSuccessMessage('If that email is registered, a password reset token has been sent.');
      setMode('confirm');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Request failed';
      setErrorMessage(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!token.trim() || !newPassword) {
      setErrorMessage('Token and new password are required');
      return;
    }
    if (newPassword.length < 10) {
      setErrorMessage('New password must be at least 10 characters long');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      await api.post(
        '/auth/password-reset/confirm',
        {
          token: token.trim(),
          password: newPassword,
        },
        { skipAuth: true },
      );
      setSuccessMessage('Password reset successfully! You can now log in.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Reset failed. Token may be expired.';
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
          <Text style={styles.title}>Password Reset</Text>
          <Text style={styles.subtitle}>
            {mode === 'request'
              ? 'Request a reset token to your email'
              : 'Enter your reset token and new password'}
          </Text>
        </View>

        <View style={styles.toggleRow}>
          <TouchableOpacity
            style={[styles.toggleTab, mode === 'request' && styles.toggleTabActive]}
            onPress={() => {
              setMode('request');
              setErrorMessage(null);
            }}
          >
            <Text style={[styles.toggleTabText, mode === 'request' && styles.toggleTabTextActive]}>
              1. Request Token
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleTab, mode === 'confirm' && styles.toggleTabActive]}
            onPress={() => {
              setMode('confirm');
              setErrorMessage(null);
            }}
          >
            <Text style={[styles.toggleTabText, mode === 'confirm' && styles.toggleTabTextActive]}>
              2. Enter Token
            </Text>
          </TouchableOpacity>
        </View>

        {successMessage && (
          <View style={styles.bannerSuccess} accessibilityRole="alert">
            <Text style={styles.bannerSuccessText}>{successMessage}</Text>
          </View>
        )}

        {errorMessage && (
          <View style={styles.bannerError} accessibilityRole="alert">
            <Text style={styles.bannerErrorText}>{errorMessage}</Text>
          </View>
        )}

        {mode === 'request' ? (
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

            <TouchableOpacity
              style={[styles.submitButton, isLoading && styles.submitButtonDisabled]}
              onPress={() => void handleRequest()}
              disabled={isLoading}
              accessibilityRole="button"
              accessibilityLabel="Send Reset Token"
            >
              {isLoading ? (
                <ActivityIndicator color={theme.color.onPrimary} />
              ) : (
                <Text style={styles.submitButtonText}>Send Reset Token</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.form}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Reset Token</Text>
              <TextInput
                style={styles.input}
                placeholder="Paste token received"
                placeholderTextColor={theme.color.onSurfaceVariant}
                value={token}
                onChangeText={setToken}
                autoCapitalize="none"
                accessibilityLabel="Reset Token"
                editable={!isLoading}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>New Password (10+ characters)</Text>
              <TextInput
                style={styles.input}
                placeholder="••••••••••"
                placeholderTextColor={theme.color.onSurfaceVariant}
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry
                accessibilityLabel="New Password"
                editable={!isLoading}
              />
            </View>

            <TouchableOpacity
              style={[styles.submitButton, isLoading && styles.submitButtonDisabled]}
              onPress={() => void handleConfirm()}
              disabled={isLoading}
              accessibilityRole="button"
              accessibilityLabel="Update Password"
            >
              {isLoading ? (
                <ActivityIndicator color={theme.color.onPrimary} />
              ) : (
                <Text style={styles.submitButtonText}>Update Password</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.footer}>
          <TouchableOpacity
            onPress={() => router.push('/(auth)/login')}
            accessibilityRole="link"
            accessibilityLabel="Back to sign in"
          >
            <Text style={styles.linkText}>Back to sign in</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
