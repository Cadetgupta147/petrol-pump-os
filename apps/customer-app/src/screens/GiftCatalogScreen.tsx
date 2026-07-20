import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  CustomerPortalError,
  createRedemption,
  isUnauthorizedError,
  type CustomerMe,
  type GiftCatalogItem,
} from '../api/customerPortalApi';
import type { LoadState } from './CustomerPortalShell';
import { EmptyView, ErrorView, LoadingView } from '../components/StateViews';
import { buildGiftRedemptionBody, clampPointsToRedeem, formatIndianNumber } from '../lib/customerPortalFormat';

interface Props {
  meState: LoadState<CustomerMe>;
  giftsState: LoadState<GiftCatalogItem[]>;
  accessToken: string;
  onRetryMe: () => void;
  onRetryGifts: () => void;
  onRedeemed: () => Promise<void>;
  onUnauthorized: () => void;
}

// A placeholder emoji per gift, since seeded data has `imageUrl: null` right
// now (per task brief) — cycles through a small fixed set so the catalog
// doesn't look monotonous, same spirit as the 🧴/🧢/🎒 icons in
// docs/gift_catalog_screen.svg. Not tied to gift name/category since the
// backend doesn't send one.
const PLACEHOLDER_EMOJIS = ['🎁', '🧴', '🧢', '🎒', '🧰', '🧺'];

function placeholderEmojiFor(giftId: string): string {
  let hash = 0;
  for (let i = 0; i < giftId.length; i++) {
    hash = (hash + giftId.charCodeAt(i)) % PLACEHOLDER_EMOJIS.length;
  }
  return PLACEHOLDER_EMOJIS[hash];
}

function messageFromError(err: unknown): string {
  return err instanceof CustomerPortalError ? err.message : 'Something went wrong. Please try again.';
}

// Section 6.4/6.6, Section 14 mockup: docs/gift_catalog_screen.svg. Renders
// the gift catalog plus, only when the pump allows both redemption levers,
// the "switch to cash discount" panel from the bottom of the mockup.
export function GiftCatalogScreen({
  meState,
  giftsState,
  accessToken,
  onRetryMe,
  onRetryGifts,
  onRedeemed,
  onUnauthorized,
}: Props) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [cashInput, setCashInput] = useState<string | null>(null);

  if (meState.status === 'loading' || giftsState.status === 'loading') {
    return <LoadingView />;
  }
  if (meState.status === 'error') {
    return <ErrorView message={meState.message} onRetry={onRetryMe} />;
  }
  if (giftsState.status === 'error') {
    return <ErrorView message={giftsState.message} onRetry={onRetryGifts} />;
  }

  const me = meState.data;
  const gifts = giftsState.data;

  if (me.redemption === null) {
    return <EmptyView message="Loyalty rewards aren't set up yet. Check back later." />;
  }

  const redemption = me.redemption;

  const handleRedeemGift = async (gift: GiftCatalogItem) => {
    setBusyKey(gift.id);
    setBanner(null);
    try {
      await createRedemption(accessToken, buildGiftRedemptionBody(redemption, gift.id));
      setBanner({ kind: 'success', text: `Redeemed! ${gift.giftName} is on its way.` });
      await onRedeemed();
    } catch (err) {
      if (isUnauthorizedError(err)) {
        onUnauthorized();
        return;
      }
      setBanner({ kind: 'error', text: messageFromError(err) });
    } finally {
      setBusyKey(null);
    }
  };

  const minCashPoints = Math.max(1, redemption.minRedeemablePoints ?? 1);
  const canSwitchToCash = me.pointsBalance >= minCashPoints;
  const cashInputValue = cashInput ?? String(clampPointsToRedeem(me.pointsBalance, me.pointsBalance, redemption.minRedeemablePoints));

  const handleSwitchToCash = async () => {
    const parsed = Number(cashInputValue);
    const pointsToRedeem = clampPointsToRedeem(parsed, me.pointsBalance, redemption.minRedeemablePoints);
    setBusyKey('cash');
    setBanner(null);
    try {
      await createRedemption(accessToken, { redemptionType: 'CASH', pointsToRedeem });
      setBanner({
        kind: 'success',
        text: `${pointsToRedeem} points switched to a cash discount for your next bill.`,
      });
      setCashInput(null);
      await onRedeemed();
    } catch (err) {
      if (isUnauthorizedError(err)) {
        onUnauthorized();
        return;
      }
      setBanner({ kind: 'error', text: messageFromError(err) });
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>Gift Catalog</Text>
        <Text style={styles.balanceLine}>
          Your balance: <Text style={styles.balanceValue}>{formatIndianNumber(me.pointsBalance)} pts</Text>
        </Text>
        <Text style={styles.balanceHint}>Set by your pump dealer — updated anytime, no reprint needed</Text>
      </View>

      {banner ? (
        <Text
          style={banner.kind === 'error' ? styles.bannerError : styles.bannerSuccess}
          testID="redemption-banner"
        >
          {banner.text}
        </Text>
      ) : null}

      {gifts.length === 0 ? (
        <EmptyView message="No gifts configured yet." />
      ) : (
        <View style={styles.giftList}>
          {gifts.map((gift) => {
            const locked = !gift.affordable;
            const isBusy = busyKey === gift.id;
            return (
              <View key={gift.id} style={[styles.giftCard, locked && styles.giftCardLocked]}>
                <View style={styles.giftIconWrap}>
                  <Text style={styles.giftIcon}>{placeholderEmojiFor(gift.id)}</Text>
                </View>
                <View style={styles.giftInfo}>
                  <Text style={[styles.giftName, locked && styles.giftNameLocked]}>{gift.giftName}</Text>
                  {!gift.inStock ? (
                    <Text style={styles.giftStockOut}>Out of stock</Text>
                  ) : locked ? (
                    <Text style={styles.giftLockedHint}>Need {gift.pointsShort} more points</Text>
                  ) : gift.stockQuantity !== null ? (
                    <Text style={styles.giftStock}>Stock: {gift.stockQuantity} left at this pump</Text>
                  ) : null}
                  <Text style={[styles.giftPoints, locked && styles.giftPointsLocked]}>
                    {formatIndianNumber(gift.pointsRequired)} pts
                  </Text>
                </View>
                <Pressable
                  style={[styles.redeemButton, (locked || !gift.inStock) && styles.redeemButtonLocked]}
                  disabled={locked || !gift.inStock || isBusy}
                  onPress={() => {
                    void handleRedeemGift(gift);
                  }}
                  testID={`redeem-gift-${gift.id}`}
                >
                  {isBusy ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text
                      style={[
                        styles.redeemButtonText,
                        (locked || !gift.inStock) && styles.redeemButtonTextLocked,
                      ]}
                    >
                      {!gift.inStock ? 'Out of stock' : locked ? 'Locked' : 'Redeem'}
                    </Text>
                  )}
                </Pressable>
              </View>
            );
          })}
        </View>
      )}

      {redemption.typeAllowed === 'BOTH' ? (
        <View style={styles.cashPanel}>
          <Text style={styles.cashPanelTitle}>Prefer cash discount instead?</Text>
          <Text style={styles.cashPanelBody}>
            Your dealer allows both: gifts OR{' '}
            {redemption.cashRedemptionRatio ? `₹${redemption.cashRedemptionRatio} per point` : 'a cash amount'}{' '}
            off your next bill.
          </Text>
          {canSwitchToCash ? (
            <View style={styles.cashRow}>
              <TextInput
                style={styles.cashInput}
                keyboardType="number-pad"
                value={cashInputValue}
                onChangeText={setCashInput}
                testID="cash-points-input"
              />
              <Pressable
                style={styles.cashButton}
                disabled={busyKey === 'cash'}
                onPress={() => {
                  void handleSwitchToCash();
                }}
                testID="switch-to-cash-button"
              >
                {busyKey === 'cash' ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.cashButtonText}>Switch to cash discount</Text>
                )}
              </Pressable>
            </View>
          ) : (
            <Text style={styles.cashPanelHint}>
              You need at least {minCashPoints} points to switch to a cash discount.
            </Text>
          )}
        </View>
      ) : null}
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
    paddingTop: 24,
    paddingBottom: 20,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 14,
  },
  balanceLine: {
    color: '#C9D1E0',
    fontSize: 13,
  },
  balanceValue: {
    color: '#FB8B24',
    fontWeight: '700',
  },
  balanceHint: {
    color: '#9AA5BD',
    fontSize: 10,
    marginTop: 4,
  },
  bannerError: {
    marginHorizontal: 24,
    marginTop: 16,
    color: '#B3282D',
    fontSize: 12,
  },
  bannerSuccess: {
    marginHorizontal: 24,
    marginTop: 16,
    color: '#1D6E63',
    fontSize: 12,
  },
  giftList: {
    paddingHorizontal: 24,
    marginTop: 20,
  },
  giftCard: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E3DECB',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    alignItems: 'center',
  },
  giftCardLocked: {
    opacity: 0.7,
  },
  giftIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 8,
    backgroundColor: '#EAF7F5',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  giftIcon: {
    fontSize: 24,
  },
  giftInfo: {
    flex: 1,
  },
  giftName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#14213D',
  },
  giftNameLocked: {
    color: '#9AA5BD',
  },
  giftStock: {
    fontSize: 10,
    color: '#6B7280',
    marginTop: 2,
  },
  giftStockOut: {
    fontSize: 10,
    color: '#B3282D',
    marginTop: 2,
  },
  giftLockedHint: {
    fontSize: 10,
    color: '#9AA5BD',
    marginTop: 2,
  },
  giftPoints: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2A9D8F',
    marginTop: 4,
  },
  giftPointsLocked: {
    color: '#9AA5BD',
  },
  redeemButton: {
    backgroundColor: '#2A9D8F',
    borderRadius: 15,
    paddingVertical: 8,
    paddingHorizontal: 14,
    minWidth: 76,
    alignItems: 'center',
  },
  redeemButtonLocked: {
    backgroundColor: '#D8D3C4',
  },
  redeemButtonText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
  },
  redeemButtonTextLocked: {
    color: '#6B7280',
  },
  cashPanel: {
    marginHorizontal: 24,
    marginTop: 12,
    backgroundColor: '#FFF4E6',
    borderRadius: 10,
    padding: 16,
  },
  cashPanelTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#B3562E',
    marginBottom: 6,
  },
  cashPanelBody: {
    fontSize: 11,
    color: '#B3562E',
    marginBottom: 12,
  },
  cashPanelHint: {
    fontSize: 11,
    color: '#B3562E',
  },
  cashRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  cashInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E3DECB',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    width: 80,
    fontSize: 13,
  },
  cashButton: {
    backgroundColor: '#FB8B24',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 14,
    flex: 1,
    alignItems: 'center',
  },
  cashButtonText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
  },
});
