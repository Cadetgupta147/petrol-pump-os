import { Platform } from 'react-native';

// Backend API base URL. Configurable via Expo's built-in EXPO_PUBLIC_ env var
// support (https://docs.expo.dev/guides/environment-variables/) so this is
// never hard-coded — see .env.example for how to set it per-platform.
//
// Fallback defaults (used only if EXPO_PUBLIC_API_BASE_URL isn't set) assume
// the backend is running locally on port 3000:
//   - Android emulator: 10.0.2.2 is the emulator's alias for the host machine's
//     localhost (the emulator has its own loopback, so plain "localhost"
//     inside the emulator does NOT reach a server running on the host).
//   - iOS simulator / web: localhost works directly, since the simulator
//     shares the host's network namespace.
//   - Physical device via Expo Go: neither 10.0.2.2 nor localhost reaches the
//     host machine from a real phone on the network — there is no usable
//     fallback default for this case. EXPO_PUBLIC_API_BASE_URL must be set
//     explicitly to the host machine's LAN IP (see .env.example).
const DEFAULT_BASE_URL = Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000';

export const API_BASE_URL =
  (process.env.EXPO_PUBLIC_API_BASE_URL as string | undefined) ?? DEFAULT_BASE_URL;
