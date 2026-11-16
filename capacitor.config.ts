import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'org.ccn.cpd',
  appName: 'CCN CPD',
  webDir: 'capacitor-web',
  server: {
    url: 'https://ccn-cpd.pages.dev',
    cleartext: false
  },
  android: {
    allowMixedContent: false
  }
};

export default config;
