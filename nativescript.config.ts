import { NativeScriptConfig } from '@nativescript/core';

export default {
  id: 'org.nativescript.nsflutter',
  appPath: 'src',
  appResourcesPath: 'App_Resources',
  android: {
    v8Flags: '--expose_gc',
    markingMode: 'none'
  },
  bundler: 'vite',
  bundlerConfigPath: 'vite.config.mts',
} as NativeScriptConfig;
