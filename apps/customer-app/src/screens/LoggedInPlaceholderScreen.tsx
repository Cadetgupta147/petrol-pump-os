import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { CustomerSummary } from '../api/customerAuthApi';

interface Props {
  customer: CustomerSummary;
  onLogOut: () => void;
}

// Deliberately minimal — this task scope is phone+OTP login ONLY. No
// dashboard, bill history, points balance, gift catalog, dues/"Pay Now", or
// navigation to any other feature (all separate, later slices per Section 5).
// This screen exists solely to confirm login succeeded and to offer a way
// back out (log out) for manual testing.
export function LoggedInPlaceholderScreen({ customer, onLogOut }: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.heading}>You're logged in</Text>
      <Text style={styles.confirmation}>{customer.name || customer.phone}</Text>
      <Text style={styles.detail}>Phone: {customer.phone}</Text>

      <Pressable style={styles.button} onPress={onLogOut} testID="logout-button">
        <Text style={styles.buttonText}>Log out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    backgroundColor: '#fff',
  },
  heading: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 16,
  },
  confirmation: {
    fontSize: 18,
    marginBottom: 8,
    textAlign: 'center',
  },
  detail: {
    fontSize: 14,
    color: '#555',
    marginBottom: 32,
  },
  button: {
    borderWidth: 1,
    borderColor: '#1a73e8',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  buttonText: {
    color: '#1a73e8',
    fontSize: 16,
    fontWeight: '600',
  },
});
