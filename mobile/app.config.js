// Public build identifiers only. Signing credentials belong in EAS, never here.
/* global module, require */
// Expo evaluates this dynamic config as CommonJS.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { existsSync } = require('node:fs');
module.exports = ({ config }) => {
  const projectId = process.env.EAS_PROJECT_ID || config.extra?.eas?.projectId;
  if (projectId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId)) {
    throw new Error('EAS_PROJECT_ID must be the existing Expo project UUID.');
  }
  if (process.env.EAS_BUILD === 'true' && !projectId) {
    throw new Error('Set the verified EAS_PROJECT_ID before building Guilded Mobile.');
  }
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON;
  if (googleServicesFile && !existsSync(googleServicesFile)) throw new Error('GOOGLE_SERVICES_JSON must point to the EAS-provided Firebase configuration file.');
  // Store bundles need Firebase for push unless the build says, on purpose, that it ships without push
  // (profile production-no-push: raid reminders stay on the phone, the Alerts tab says push is not set up).
  const storeProfile = ['production', 'store'].includes(process.env.EAS_BUILD_PROFILE || '');
  if (process.env.EAS_BUILD === 'true' && process.env.EAS_BUILD_PLATFORM === 'android' && storeProfile && !googleServicesFile && process.env.GUILDED_MOBILE_NO_PUSH !== '1') {
    throw new Error('Production Android builds require the Firebase GOOGLE_SERVICES_JSON file environment variable for push. Use the production-no-push profile for a bundle with device reminders only; preview APKs build without it.');
  }
  return {
    ...config,
    ...(process.env.EAS_OWNER ? { owner: process.env.EAS_OWNER } : {}),
    android: { ...config.android, ...(googleServicesFile ? { googleServicesFile } : {}) },
    extra: { ...config.extra, ...(projectId ? { eas: { projectId } } : {}) },
    updates: {
      ...config.updates,
      enabled: Boolean(projectId),
      ...(projectId ? { url: `https://u.expo.dev/${projectId}` } : {}),
    },
  };
};
