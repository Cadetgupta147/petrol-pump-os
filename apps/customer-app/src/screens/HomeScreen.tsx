import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { CustomerBill, CustomerMe, GiftCatalogItem } from '../api/customerPortalApi';
import type { LoadState } from './CustomerPortalShell';
import { EmptyView, ErrorView, LoadingView } from '../components/StateViews';
import {
  countAffordableGifts,
  formatBillTimestamp,
  formatIndianNumber,
  formatPointsSubtext,
} from '../lib/customerPortalFormat';

const RECENT_BILLS_PREVIEW_COUNT = 2;

interface Props {
  meState: LoadState<CustomerMe>;
  billsState: LoadState<CustomerBill[]>;
  giftsState: LoadState<GiftCatalogItem[]>;
  onRetryMe: () => void;
  onRetryBills: () => void;
  onNavigateToRewards: () => void;
  onNavigateToHistory: () => void;
}

// Section 14 mockup: docs/credit_customer_app_home.svg. The "Link your
// physical QR loyalty card" banner in that mockup is deliberately NOT built
// here — there's no backend support for it (no such endpoint exists in
// apps/backend/src/customer-portal), and it's outside this task's four-route
// contract. See the customer-app README for this and other mockup
// deviations.
export function HomeScreen({
  meState,
  billsState,
  giftsState,
  onRetryMe,
  onRetryBills,
  onNavigateToRewards,
  onNavigateToHistory,
}: Props) {
  const [payNowMessage, setPayNowMessage] = useState<string | null>(null);

  if (meState.status === 'loading') {
    return <LoadingView />;
  }
  if (meState.status === 'error') {
    return <ErrorView message={meState.message} onRetry={onRetryMe} />;
  }

  const me = meState.data;
  const affordableGiftCount = giftsState.status === 'ready' ? countAffordableGifts(giftsState.data) : null;
  const subtext = formatPointsSubtext(
    me.pointsBalance,
    me.redemption?.cashRedemptionRatio,
    affordableGiftCount,
  );

  const showCashCard = me.redemption?.typeAllowed === 'CASH' || me.redemption?.typeAllowed === 'BOTH';
  const showGiftCard = me.redemption?.typeAllowed === 'GIFT' || me.redemption?.typeAllowed === 'BOTH';

  const recentBills = billsState.status === 'ready' ? billsState.data.slice(0, RECENT_BILLS_PREVIEW_COUNT) : [];

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.greeting}>Hi {me.name || 'there'} 👋</Text>
        <Text style={styles.balanceLabel}>Loyalty balance</Text>
        <View style={styles.balanceRow}>
          <Text style={styles.balanceValue}>{formatIndianNumber(me.pointsBalance)} pts</Text>
          {subtext ? <Text style={styles.balanceSubtext}>{subtext}</Text> : null}
        </View>
      </View>

      {me.outstandingBalance > 0 ? (
        <View style={styles.dueCard} testID="outstanding-due-card">
          <View>
            <Text style={styles.dueLabel}>Outstanding due</Text>
            <Text style={styles.dueValue}>₹{formatIndianNumber(me.outstandingBalance)}</Text>
          </View>
          <Pressable
            style={styles.payNowButton}
            onPress={() =>
              setPayNowMessage('Online payment is coming soon — please pay at the counter for now.')
            }
            testID="pay-now-button"
          >
            <Text style={styles.payNowButtonText}>Pay Now</Text>
          </Pressable>
        </View>
      ) : null}
      {payNowMessage ? <Text style={styles.payNowNotice}>{payNowMessage}</Text> : null}

      {me.redemption === null ? null : (
        <View style={styles.redeemSection}>
          <Text style={styles.sectionTitle}>Redeem your points</Text>
          <View style={styles.redeemCards}>
            {showCashCard ? (
              <Pressable
                style={styles.redeemCard}
                onPress={onNavigateToRewards}
                testID="redeem-cash-card"
              >
                <Text style={styles.redeemCardTitle}>Cash discount</Text>
                {me.redemption.cashRedemptionRatio ? (
                  <Text style={styles.redeemCardDetail}>
                    1 pt = ₹{me.redemption.cashRedemptionRatio} off next bill
                  </Text>
                ) : null}
                <View style={styles.redeemCardButton}>
                  <Text style={styles.redeemCardButtonText}>View options →</Text>
                </View>
              </Pressable>
            ) : null}
            {showGiftCard ? (
              <Pressable
                style={styles.redeemCard}
                onPress={onNavigateToRewards}
                testID="redeem-gift-card"
              >
                <Text style={styles.redeemCardTitle}>Gift catalog</Text>
                <Text style={styles.redeemCardDetail}>
                  {affordableGiftCount !== null
                    ? `${affordableGiftCount} gift${affordableGiftCount === 1 ? '' : 's'} available at your balance`
                    : 'Browse what you can redeem'}
                </Text>
                <View style={[styles.redeemCardButton, styles.redeemCardButtonTeal]}>
                  <Text style={styles.redeemCardButtonText}>Browse gifts →</Text>
                </View>
              </Pressable>
            ) : null}
          </View>
        </View>
      )}

      <View style={styles.recentSection}>
        <Pressable onPress={onNavigateToHistory} testID="recent-bills-header">
          <Text style={styles.sectionTitle}>Recent bills</Text>
        </Pressable>
        {billsState.status === 'loading' ? (
          <LoadingView />
        ) : billsState.status === 'error' ? (
          <ErrorView message={billsState.message} onRetry={onRetryBills} />
        ) : recentBills.length === 0 ? (
          <EmptyView message="No bills yet." />
        ) : (
          recentBills.map((bill) => (
            <View key={bill.id} style={styles.billRow}>
              <View style={styles.billRowTop}>
                <Text style={styles.billDate}>{formatBillTimestamp(bill.timestamp)}</Text>
                <Text style={styles.billAmount}>₹{formatIndianNumber(bill.amount)}</Text>
              </View>
              <Text style={styles.billDetail}>
                {bill.litres}L {bill.productType} · +{bill.loyaltyPointsEarned} pts earned
              </Text>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F7F5F0',
  },
  content: {
    paddingBottom: 32,
  },
  header: {
    backgroundColor: '#14213D',
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 24,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  greeting: {
    color: '#C9D1E0',
    fontSize: 14,
    marginBottom: 20,
  },
  balanceLabel: {
    color: '#9AA5BD',
    fontSize: 13,
    marginBottom: 4,
  },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
  },
  balanceValue: {
    color: '#FB8B24',
    fontSize: 32,
    fontWeight: '700',
    marginRight: 12,
  },
  balanceSubtext: {
    color: '#9AA5BD',
    fontSize: 12,
  },
  dueCard: {
    marginHorizontal: 24,
    marginTop: 20,
    backgroundColor: '#FDEDED',
    borderRadius: 10,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dueLabel: {
    color: '#B3282D',
    fontSize: 12,
    marginBottom: 4,
  },
  dueValue: {
    color: '#B3282D',
    fontSize: 20,
    fontWeight: '700',
  },
  payNowButton: {
    backgroundColor: '#E63946',
    borderRadius: 18,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  payNowButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  payNowNotice: {
    marginHorizontal: 24,
    marginTop: 8,
    color: '#B3282D',
    fontSize: 12,
  },
  redeemSection: {
    paddingHorizontal: 24,
    marginTop: 28,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#14213D',
    marginBottom: 12,
  },
  redeemCards: {
    flexDirection: 'row',
    gap: 12,
  },
  redeemCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E3DECB',
    borderRadius: 10,
    padding: 14,
    justifyContent: 'space-between',
  },
  redeemCardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#14213D',
    marginBottom: 6,
  },
  redeemCardDetail: {
    fontSize: 11,
    color: '#6B7280',
    marginBottom: 14,
  },
  redeemCardButton: {
    backgroundColor: '#FB8B24',
    borderRadius: 12,
    paddingVertical: 8,
    alignItems: 'center',
  },
  redeemCardButtonTeal: {
    backgroundColor: '#2A9D8F',
  },
  redeemCardButtonText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
  },
  recentSection: {
    paddingHorizontal: 24,
    marginTop: 28,
  },
  billRow: {
    borderTopWidth: 1,
    borderTopColor: '#EEE',
    paddingVertical: 12,
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
    fontSize: 13,
    fontWeight: '700',
    color: '#14213D',
  },
  billDetail: {
    fontSize: 11,
    color: '#9AA5BD',
    marginTop: 4,
  },
});
