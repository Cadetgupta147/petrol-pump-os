import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { PortalTab } from '../screens/CustomerPortalShell';

interface TabDef {
  key: PortalTab;
  label: string;
  icon: string;
}

// Section 14 mockup's bottom nav (Home / History / Rewards / Profile) —
// Profile is explicitly out of scope for this slice (see task brief), so
// only three tabs are wired here. Hand-rolled rather than a navigation
// library, matching App.tsx's existing screen-swap-via-local-state pattern.
const TABS: TabDef[] = [
  { key: 'home', label: 'Home', icon: '🏠' },
  { key: 'history', label: 'History', icon: '📜' },
  { key: 'rewards', label: 'Rewards', icon: '🎁' },
];

interface Props {
  active: PortalTab;
  onSelect: (tab: PortalTab) => void;
}

export function BottomTabBar({ active, onSelect }: Props) {
  return (
    <View style={styles.bar}>
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Pressable
            key={tab.key}
            style={styles.tab}
            onPress={() => onSelect(tab.key)}
            testID={`tab-${tab.key}`}
          >
            <Text style={[styles.label, isActive ? styles.labelActive : styles.labelInactive]}>
              {tab.icon} {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#EEE',
    backgroundColor: '#FFFFFF',
    paddingVertical: 10,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
  },
  label: {
    fontSize: 12,
  },
  labelActive: {
    color: '#14213D',
    fontWeight: '700',
  },
  labelInactive: {
    color: '#9AA5BD',
  },
});
