import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { BottomTabBar } from '../components/BottomTabBar';
import {
  CustomerPortalError,
  getBills,
  getGiftCatalog,
  getMe,
  isUnauthorizedError,
  type CustomerBill,
  type CustomerMe,
  type GiftCatalogItem,
} from '../api/customerPortalApi';
import { HomeScreen } from './HomeScreen';
import { BillHistoryScreen } from './BillHistoryScreen';
import { GiftCatalogScreen } from './GiftCatalogScreen';

export type PortalTab = 'home' | 'history' | 'rewards';

export type LoadState<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: T };

interface Props {
  accessToken: string;
  onUnauthorized: () => void;
}

function errorState(err: unknown): { status: 'error'; message: string } {
  const message = err instanceof CustomerPortalError ? err.message : 'Something went wrong. Please try again.';
  return { status: 'error', message };
}

// Section 5/6 — the logged-in shell for the Credit Customer App: a small
// hand-rolled tab switcher (Home / History / Rewards) driven by local state,
// same spirit as App.tsx's own screen-swap state machine (no navigation
// library, per the task brief). Profile is intentionally omitted — out of
// scope for this slice.
//
// Owns all three data fetches (me/bills/gift-catalog) centrally so:
// - a 401 from any of them is handled in exactly one place (forced logout
//   via onUnauthorized, which App.tsx wires to clearCustomerSession())
// - a successful redemption (made inside GiftCatalogScreen) can refresh both
//   the balance and the catalog without each tab re-fetching independently
export function CustomerPortalShell({ accessToken, onUnauthorized }: Props) {
  const [tab, setTab] = useState<PortalTab>('home');
  const [meState, setMeState] = useState<LoadState<CustomerMe>>({ status: 'loading' });
  const [billsState, setBillsState] = useState<LoadState<CustomerBill[]>>({ status: 'loading' });
  const [giftsState, setGiftsState] = useState<LoadState<GiftCatalogItem[]>>({ status: 'loading' });

  const loadMe = useCallback(async () => {
    setMeState({ status: 'loading' });
    try {
      const data = await getMe(accessToken);
      setMeState({ status: 'ready', data });
    } catch (err) {
      if (isUnauthorizedError(err)) {
        onUnauthorized();
        return;
      }
      setMeState(errorState(err));
    }
  }, [accessToken, onUnauthorized]);

  const loadBills = useCallback(async () => {
    setBillsState({ status: 'loading' });
    try {
      const data = await getBills(accessToken);
      setBillsState({ status: 'ready', data });
    } catch (err) {
      if (isUnauthorizedError(err)) {
        onUnauthorized();
        return;
      }
      setBillsState(errorState(err));
    }
  }, [accessToken, onUnauthorized]);

  const loadGifts = useCallback(async () => {
    setGiftsState({ status: 'loading' });
    try {
      const data = await getGiftCatalog(accessToken);
      setGiftsState({ status: 'ready', data });
    } catch (err) {
      if (isUnauthorizedError(err)) {
        onUnauthorized();
        return;
      }
      setGiftsState(errorState(err));
    }
  }, [accessToken, onUnauthorized]);

  useEffect(() => {
    // Runs once per mounted shell (i.e. once per login/app-open) — retries
    // and the post-redemption refresh below re-trigger loadMe/loadBills/
    // loadGifts individually afterwards, so this intentionally does not
    // re-run on every render of those callbacks. The setState calls inside
    // load*() are the fetch itself starting (loading -> ready/error), the
    // standard data-fetching effect idiom — same pattern/suppression as
    // apps/dsm-app/src/screens/CreditCustomerPicker.tsx's identical fetch
    // effect, not the derived-state anti-pattern the rule targets.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadMe();
    void loadBills();
    void loadGifts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRedeemed = useCallback(async () => {
    // Redemption changes both the customer's points balance (/me) and the
    // catalog's affordability/stock (/gift-catalog) — refresh both so the
    // Rewards screen and a subsequent Home visit both reflect it.
    await Promise.all([loadMe(), loadGifts()]);
  }, [loadMe, loadGifts]);

  let content;
  if (tab === 'home') {
    content = (
      <HomeScreen
        meState={meState}
        billsState={billsState}
        giftsState={giftsState}
        onRetryMe={() => void loadMe()}
        onRetryBills={() => void loadBills()}
        onNavigateToRewards={() => setTab('rewards')}
        onNavigateToHistory={() => setTab('history')}
      />
    );
  } else if (tab === 'history') {
    content = <BillHistoryScreen billsState={billsState} onRetry={() => void loadBills()} />;
  } else {
    content = (
      <GiftCatalogScreen
        meState={meState}
        giftsState={giftsState}
        accessToken={accessToken}
        onRetryMe={() => void loadMe()}
        onRetryGifts={() => void loadGifts()}
        onRedeemed={handleRedeemed}
        onUnauthorized={onUnauthorized}
      />
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.content}>{content}</View>
      <BottomTabBar active={tab} onSelect={setTab} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F5F0',
  },
  content: {
    flex: 1,
  },
});
