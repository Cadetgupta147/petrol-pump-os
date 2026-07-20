import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { CustomerBill } from '../api/customerPortalApi';
import type { LoadState } from './CustomerPortalShell';
import { EmptyView, ErrorView, LoadingView } from '../components/StateViews';
import { formatBillTimestamp, formatIndianNumber } from '../lib/customerPortalFormat';

interface Props {
  billsState: LoadState<CustomerBill[]>;
  onRetry: () => void;
}

// Section 5's "Bill history — Itemized view of every past bill: date,
// litres, amount, points earned". Full list (up to the backend's 100-row
// cap), newest first, as returned by GET /customer-portal/bills.
export function BillHistoryScreen({ billsState, onRetry }: Props) {
  return (
    <View style={styles.screen}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Bill History</Text>
        <Pressable onPress={onRetry} testID="history-refresh-button">
          <Text style={styles.refreshLabel}>Refresh</Text>
        </Pressable>
      </View>

      {billsState.status === 'loading' ? (
        <LoadingView />
      ) : billsState.status === 'error' ? (
        <ErrorView message={billsState.message} onRetry={onRetry} />
      ) : billsState.data.length === 0 ? (
        <EmptyView message="No bills yet. Your fill-ups will show up here." />
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {billsState.data.map((bill) => (
            <View key={bill.id} style={styles.billCard}>
              <View style={styles.billRowTop}>
                <Text style={styles.billDate}>{formatBillTimestamp(bill.timestamp)}</Text>
                <Text style={styles.billAmount}>₹{formatIndianNumber(bill.amount)}</Text>
              </View>
              <Text style={styles.billDetail}>
                {bill.litres}L {bill.productType}
              </Text>
              <Text style={styles.billPoints}>+{bill.loyaltyPointsEarned} pts earned</Text>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F7F5F0',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#14213D',
  },
  refreshLabel: {
    fontSize: 13,
    color: '#2A9D8F',
    fontWeight: '600',
  },
  list: {
    paddingHorizontal: 24,
    paddingBottom: 32,
  },
  billCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E3DECB',
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
  },
  billRowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  billDate: {
    fontSize: 12,
    color: '#333',
  },
  billAmount: {
    fontSize: 14,
    fontWeight: '700',
    color: '#14213D',
  },
  billDetail: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 6,
  },
  billPoints: {
    fontSize: 11,
    color: '#2A9D8F',
    marginTop: 4,
    fontWeight: '600',
  },
});
