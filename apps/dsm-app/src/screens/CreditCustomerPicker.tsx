import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { listCustomers, CustomersApiError, type CustomerSummary } from '../api/customersApi';

interface Props {
  visible: boolean;
  accessToken: string;
  onSelectExisting: (customer: CustomerSummary) => void;
  onQuickAdd: (input: { name: string; vehicleNumber: string }) => void;
  onCancel: () => void;
}

// Section 5A.3 — "Credit can be one of the split lines too." There is no
// customer search endpoint (GET /customers has no query params), so this is
// a lightweight client-side picker: fetch the full customer list once per
// time the picker is opened, let the DSM filter it by typing, and either
// pick an existing customer or quick-add a new one (Section 3.4A —
// name + vehicle number only, both required).
export function CreditCustomerPicker({ visible, accessToken, onSelectExisting, onQuickAdd, onCancel }: Props) {
  const [customers, setCustomers] = useState<CustomerSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickAddName, setQuickAddName] = useState('');
  const [quickAddVehicle, setQuickAddVehicle] = useState('');
  const [quickAddError, setQuickAddError] = useState<string | null>(null);

  // Reset the picker's own form state (search text, quick-add draft) each
  // time it opens — render-time prev-value-comparison pattern, so this only
  // fires on an actual open/close transition, not on an unrelated
  // accessToken change (e.g. a mid-session token refresh) that would
  // otherwise silently wipe whatever the DSM had typed into search or a
  // half-filled quick-add form.
  const [prevVisible, setPrevVisible] = useState(visible);
  if (visible !== prevVisible) {
    setPrevVisible(visible);
    if (visible) {
      setSearch('');
      setShowQuickAdd(false);
      setQuickAddName('');
      setQuickAddVehicle('');
      setQuickAddError(null);
    }
  }

  useEffect(() => {
    if (!visible) return;
    // "Fetch once" per open (or again if the token changes while open) —
    // not on every keystroke. Resetting loading/error state right before
    // firing the request is the standard data-fetching effect idiom (this
    // is what the fetch effect itself is for, per the task scope), not
    // state derived from other state — the lint rule doesn't distinguish
    // that from the anti-pattern it's built to catch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadError(null);
    setLoading(true);
    listCustomers(accessToken)
      .then((result) => setCustomers(result))
      .catch((error) => {
        const message = error instanceof CustomersApiError ? error.message : 'Could not load customers.';
        setLoadError(message);
      })
      .finally(() => setLoading(false));
  }, [visible, accessToken]);

  const filtered = useMemo(() => {
    if (!customers) return [];
    const needle = search.trim().toLowerCase();
    if (!needle) return customers;
    return customers.filter((customer) => {
      return (
        customer.name.toLowerCase().includes(needle) ||
        (customer.vehicleNumber ?? '').toLowerCase().includes(needle) ||
        (customer.phone ?? '').toLowerCase().includes(needle)
      );
    });
  }, [customers, search]);

  const handleQuickAddSubmit = () => {
    const name = quickAddName.trim();
    const vehicleNumber = quickAddVehicle.trim();
    if (!name || !vehicleNumber) {
      setQuickAddError('Both name and vehicle number are required to quick-add a customer.');
      return;
    }
    onQuickAdd({ name, vehicleNumber });
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <View style={styles.container}>
        <Text style={styles.title}>Select Credit Customer</Text>

        {loading ? (
          <ActivityIndicator size="large" style={styles.loading} />
        ) : loadError ? (
          <Text style={styles.error} testID="credit-picker-error">
            {loadError}
          </Text>
        ) : showQuickAdd ? (
          <View style={styles.quickAddSection}>
            <Text style={styles.label}>Name</Text>
            <TextInput
              style={styles.input}
              value={quickAddName}
              onChangeText={setQuickAddName}
              placeholder="Customer name"
              testID="quick-add-name-input"
            />
            <Text style={styles.label}>Vehicle Number</Text>
            <TextInput
              style={styles.input}
              value={quickAddVehicle}
              onChangeText={setQuickAddVehicle}
              placeholder="e.g. DL01AB1234"
              autoCapitalize="characters"
              testID="quick-add-vehicle-input"
            />
            {quickAddError ? <Text style={styles.error}>{quickAddError}</Text> : null}
            <Pressable style={styles.button} onPress={handleQuickAddSubmit} testID="quick-add-submit-button">
              <Text style={styles.buttonText}>Add & Use</Text>
            </Pressable>
            <Pressable style={styles.linkButton} onPress={() => setShowQuickAdd(false)}>
              <Text style={styles.linkButtonText}>Back to customer list</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <TextInput
              style={styles.input}
              value={search}
              onChangeText={setSearch}
              placeholder="Search by name, vehicle, or phone"
              testID="credit-search-input"
            />
            <FlatList
              data={filtered}
              keyExtractor={(item) => item.id}
              style={styles.list}
              ListEmptyComponent={<Text style={styles.emptyText}>No matching customers.</Text>}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.customerRow}
                  onPress={() => onSelectExisting(item)}
                  testID={`credit-customer-${item.id}`}
                >
                  <Text style={styles.customerName}>
                    {item.name} {item.verificationStatus === 'INFORMAL' ? '(informal)' : ''}
                  </Text>
                  <Text style={styles.customerDetail}>
                    {item.vehicleNumber ?? 'no vehicle on file'} {item.phone ? `· ${item.phone}` : ''}
                  </Text>
                </Pressable>
              )}
            />
            <Pressable style={styles.buttonSecondary} onPress={() => setShowQuickAdd(true)} testID="quick-add-open-button">
              <Text style={styles.buttonSecondaryText}>Quick add new customer</Text>
            </Pressable>
          </>
        )}

        <Pressable style={styles.linkButton} onPress={onCancel} testID="credit-picker-cancel-button">
          <Text style={styles.linkButtonText}>Cancel</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    paddingHorizontal: 24,
    paddingTop: 48,
    paddingBottom: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 16,
    textAlign: 'center',
  },
  loading: {
    marginTop: 32,
  },
  label: {
    fontSize: 14,
    color: '#444',
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    marginBottom: 12,
  },
  error: {
    color: '#b00020',
    marginBottom: 12,
  },
  list: {
    flex: 1,
  },
  emptyText: {
    color: '#666',
    textAlign: 'center',
    marginTop: 24,
  },
  customerRow: {
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    paddingVertical: 12,
  },
  customerName: {
    fontSize: 16,
    fontWeight: '600',
  },
  customerDetail: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
  },
  quickAddSection: {
    flex: 1,
  },
  button: {
    backgroundColor: '#1a73e8',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  buttonSecondary: {
    borderWidth: 1,
    borderColor: '#1a73e8',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonSecondaryText: {
    color: '#1a73e8',
    fontSize: 16,
    fontWeight: '600',
  },
  linkButton: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  linkButtonText: {
    color: '#1a73e8',
    fontSize: 15,
    fontWeight: '600',
  },
});
