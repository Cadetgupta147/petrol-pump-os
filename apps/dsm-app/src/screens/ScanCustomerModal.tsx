import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import {
  CustomersApiError,
  getCustomerByMemberId,
  hasMemberIdShape,
  type CustomerLookup,
} from '../api/customersApi';

interface Props {
  visible: boolean;
  accessToken: string;
  onResolved: (customer: CustomerLookup) => void;
  onCancel: () => void;
}

// How long an unrecognized/failed scan stays "locked" before the camera is
// allowed to fire again — without this, onBarcodeScanned re-fires many times
// a second while the same bad QR is still in front of the lens.
const RESCAN_DELAY_MS = 1_500;

// Section 6.3 steps 1–3 + Section 6.1 manual fallback — the DSM points the
// phone camera at the customer's QR loyalty card (Section 6.7: the card
// encodes ONLY the member ID string, never balance/rate/personal data), or
// types the printed member ID by hand when the camera fails or the card is
// damaged. Both paths run the exact same lookup:
//   payload -> shape check (untrusted text!) -> GET /customers/by-member-id.
// Server error messages (400 check-digit typo, 404 unknown ID) are shown
// verbatim. The resolved minimal customer is handed back to NewBillScreen.
export function ScanCustomerModal({ visible, accessToken, onResolved, onCancel }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [manualId, setManualId] = useState('');
  const [lookingUp, setLookingUp] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ref (not state) so the onBarcodeScanned callback sees the current value
  // synchronously between rapid scanner callbacks.
  const scanLockedRef = useRef(false);
  const rescanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (visible) {
      setManualId('');
      setLookingUp(false);
      setError(null);
      scanLockedRef.current = false;
    }
    return () => {
      if (rescanTimerRef.current) {
        clearTimeout(rescanTimerRef.current);
        rescanTimerRef.current = null;
      }
    };
  }, [visible]);

  const unlockScanningSoon = () => {
    if (rescanTimerRef.current) clearTimeout(rescanTimerRef.current);
    rescanTimerRef.current = setTimeout(() => {
      scanLockedRef.current = false;
    }, RESCAN_DELAY_MS);
  };

  const lookUp = async (rawId: string) => {
    // The QR payload (or typed text) is untrusted — normalize and shape-check
    // before it goes anywhere near the API (Section 6.1: the QR is a pointer,
    // and a QR from outside this system should resolve to nothing, loudly).
    const id = rawId.trim().toUpperCase();
    if (!hasMemberIdShape(id)) {
      setError(
        `"${id || rawId}" doesn't look like a member ID — expected e.g. PUMP001-CUST-04521-6.`,
      );
      unlockScanningSoon();
      return;
    }

    setLookingUp(true);
    setError(null);
    try {
      const customer = await getCustomerByMemberId(id, accessToken);
      onResolved(customer);
      // Parent closes the modal; the visible-effect resets state on reopen.
    } catch (lookupError) {
      const message =
        lookupError instanceof CustomersApiError
          ? lookupError.message
          : 'Something went wrong looking up that member ID.';
      setError(message);
      unlockScanningSoon();
    } finally {
      setLookingUp(false);
    }
  };

  const handleBarcodeScanned = (result: BarcodeScanningResult) => {
    if (scanLockedRef.current || lookingUp) return;
    scanLockedRef.current = true;
    void lookUp(result.data);
  };

  const handleManualLookup = () => {
    if (!manualId.trim() || lookingUp) return;
    void lookUp(manualId);
  };

  const cameraGranted = permission?.granted === true;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <View style={styles.container}>
        <Text style={styles.title}>Scan Customer QR</Text>

        {cameraGranted ? (
          <View style={styles.cameraWrapper} testID="qr-camera-wrapper">
            <CameraView
              style={styles.camera}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={lookingUp ? undefined : handleBarcodeScanned}
            />
            <Text style={styles.cameraHint}>Point the camera at the customer's loyalty card.</Text>
          </View>
        ) : (
          <View style={styles.permissionBox} testID="camera-permission-box">
            <Text style={styles.permissionText}>
              {permission
                ? 'Camera access is needed to scan loyalty cards.'
                : 'Checking camera access…'}
            </Text>
            {permission && permission.canAskAgain !== false ? (
              <Pressable
                style={styles.buttonSecondary}
                onPress={() => {
                  void requestPermission();
                }}
                testID="grant-camera-button"
              >
                <Text style={styles.buttonSecondaryText}>Allow Camera</Text>
              </Pressable>
            ) : null}
            {permission && !permission.granted ? (
              <Text style={styles.permissionSubtext}>
                You can still type the member ID printed on the card below.
              </Text>
            ) : null}
          </View>
        )}

        {/* Section 6.1 manual fallback — camera broken / card damaged. */}
        <Text style={styles.label}>Or type the member ID from the card</Text>
        <TextInput
          style={styles.input}
          value={manualId}
          onChangeText={setManualId}
          placeholder="e.g. PUMP001-CUST-04521-6"
          autoCapitalize="characters"
          autoCorrect={false}
          editable={!lookingUp}
          onSubmitEditing={handleManualLookup}
          testID="manual-member-id-input"
        />

        {error ? (
          <Text style={styles.error} testID="scan-error">
            {error}
          </Text>
        ) : null}

        <Pressable
          style={[styles.button, (lookingUp || !manualId.trim()) && styles.buttonDisabled]}
          onPress={handleManualLookup}
          disabled={lookingUp || !manualId.trim()}
          testID="manual-lookup-button"
        >
          {lookingUp ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Look Up</Text>}
        </Pressable>

        <Pressable style={styles.backButton} onPress={onCancel} testID="scan-cancel-button">
          <Text style={styles.backButtonText}>Cancel</Text>
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
    paddingVertical: 32,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 16,
    textAlign: 'center',
  },
  cameraWrapper: {
    marginBottom: 16,
  },
  camera: {
    height: 280,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  cameraHint: {
    marginTop: 8,
    fontSize: 13,
    color: '#666',
    textAlign: 'center',
  },
  permissionBox: {
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
    alignItems: 'center',
  },
  permissionText: {
    fontSize: 15,
    color: '#444',
    textAlign: 'center',
    marginBottom: 8,
  },
  permissionSubtext: {
    fontSize: 13,
    color: '#666',
    textAlign: 'center',
    marginTop: 8,
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
  button: {
    backgroundColor: '#1a73e8',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonDisabled: {
    backgroundColor: '#9db8e8',
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
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  buttonSecondaryText: {
    color: '#1a73e8',
    fontSize: 16,
    fontWeight: '600',
  },
  backButton: {
    marginTop: 16,
    alignItems: 'center',
  },
  backButtonText: {
    color: '#1a73e8',
    fontSize: 15,
    fontWeight: '600',
  },
});
