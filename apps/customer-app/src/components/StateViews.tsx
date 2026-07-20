import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

// Shared loading / retry-able-error / empty states for the customer-portal
// screens (Home, History, Rewards) — every screen in this slice needs all
// three per the task brief, so this centralizes them instead of
// re-implementing per screen.

export function LoadingView() {
  return (
    <View style={styles.centered} testID="portal-loading">
      <ActivityIndicator size="large" color="#14213D" />
    </View>
  );
}

interface ErrorViewProps {
  message: string;
  onRetry: () => void;
}

export function ErrorView({ message, onRetry }: ErrorViewProps) {
  return (
    <View style={styles.centered} testID="portal-error">
      <Text style={styles.errorText}>{message}</Text>
      <Pressable style={styles.retryButton} onPress={onRetry} testID="portal-retry-button">
        <Text style={styles.retryButtonText}>Try again</Text>
      </Pressable>
    </View>
  );
}

interface EmptyViewProps {
  message: string;
}

export function EmptyView({ message }: EmptyViewProps) {
  return (
    <View style={styles.centered} testID="portal-empty">
      <Text style={styles.emptyText}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingVertical: 48,
  },
  errorText: {
    color: '#B3282D',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16,
  },
  retryButton: {
    borderWidth: 1,
    borderColor: '#14213D',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  retryButtonText: {
    color: '#14213D',
    fontSize: 14,
    fontWeight: '600',
  },
  emptyText: {
    color: '#6B7280',
    fontSize: 14,
    textAlign: 'center',
  },
});
