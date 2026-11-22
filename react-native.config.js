module.exports = {
  project: {
    android: {
      sourceDir: './apps/mobile/android',
      appName: 'app',
      packageName: 'com.rota.mobile',
    },
  },
  dependencies: {
    expo: {
      platforms: {
        android: {
          packageImportPath: 'import expo.modules.ExpoModulesPackage;',
          packageInstance: 'new ExpoModulesPackage()',
        },
      },
    },
  },
};
