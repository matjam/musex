module.exports = (api) => {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    // No manual reanimated/worklets plugin: babel-preset-expo (SDK 56) auto-adds
    // react-native-worklets/plugin when the package is installed. Reanimated 4
    // moved the Babel plugin to react-native-worklets/plugin and the preset
    // injects it itself — adding it here would duplicate the worklets transform.
  };
};
