import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { StaffSummary } from '../api/authApi';

interface Props {
  staff: StaffSummary;
  onLogOut: () => void;
}

// Minimal proof-of-login confirmation screen — the entire success-path UI
// for this slice. Deliberately does NOT navigate anywhere else (no
// shift/meter-reading/New Bill screens — those are separate, later slices
// per Section 4).
export function LoggedInScreen({ staff, onLogOut }: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Logged in</Text>
      <Text style={styles.confirmation}>
        Logged in as {staff.name} ({staff.role})
      </Text>
      <Text style={styles.detail}>Phone: {staff.phone}</Text>

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
