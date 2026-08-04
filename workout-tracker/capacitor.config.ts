import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.willchan.workouttracker',
  appName: 'Workout Tracker',
  webDir: 'dist',
  ios: {
    contentInset: 'automatic',
  },
  plugins: {
    LocalNotifications: {
      presentationOptions: ['badge', 'sound', 'banner', 'list'],
    },
    CapacitorUpdater: {
      // GitHub Pages only serves static GETs, but the plugin's built-in
      // autoUpdate/updateUrl flow expects a POST-based update-check API — so
      // auto-update is off here and src/native/otaUpdate.ts drives the same
      // self-hosted channel manually via plain fetch() + download()/set().
      autoUpdate: false,
    },
  },
};

export default config;
