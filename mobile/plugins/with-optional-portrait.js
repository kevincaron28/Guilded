/* global module, require */
// The app stays portrait (app.json "orientation"), but Play reads that as a required
// android.hardware.screen.portrait feature and hides the app from devices without it
// (some tablets, Chromebooks, Android XR). Declaring the feature optional keeps them.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { withAndroidManifest } = require('expo/config-plugins');

const FEATURE = 'android.hardware.screen.portrait';

function markPortraitOptional(manifest) {
  const root = manifest.manifest;
  const features = (root['uses-feature'] = root['uses-feature'] || []);
  const existing = features.find((f) => f.$ && f.$['android:name'] === FEATURE);
  if (existing) existing.$['android:required'] = 'false';
  else features.push({ $: { 'android:name': FEATURE, 'android:required': 'false' } });
  return manifest;
}

const withOptionalPortrait = (config) =>
  withAndroidManifest(config, (cfg) => {
    cfg.modResults = markPortraitOptional(cfg.modResults);
    return cfg;
  });

module.exports = withOptionalPortrait;
module.exports.markPortraitOptional = markPortraitOptional;
