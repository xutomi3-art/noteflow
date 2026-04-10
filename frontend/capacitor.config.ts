import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.jotoai.noteflow',
  appName: 'Noteflow',
  webDir: 'dist',
  server: {
    url: 'https://cloud.jototech.cn:1001',
    cleartext: true,
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      androidScaleType: 'CENTER_CROP',
    },
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true,
    },
  },
};

export default config;
