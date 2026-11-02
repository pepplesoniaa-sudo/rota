import React from 'react';
import { View, Text } from 'react-native';
import { useAppStore } from '../../lib/state/app-store';
import { makeStyles } from '../theme/makeStyles';

const useStyles = makeStyles((theme) => ({
  banner: {
    backgroundColor: theme.color.warningContainer,
    paddingVertical: theme.space[2] ?? 8,
    paddingHorizontal: theme.space[4] ?? 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    color: theme.color.onWarningContainer,
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: '500',
    textAlign: 'center',
  },
}));

/**
 * FR-32: Banner shown when offline:
 * - "Offline. Last updated {S}."
 * - "No offline schedule. Connect to update." (if > 14 days or never synced).
 */
export function OfflineBanner(): React.JSX.Element | null {
  const styles = useStyles();
  const bannerText = useAppStore((state) => state.getOfflineBannerText());

  if (!bannerText) {
    return null;
  }

  return (
    <View style={styles.banner} accessibilityRole="alert">
      <Text style={styles.text}>{bannerText}</Text>
    </View>
  );
}
