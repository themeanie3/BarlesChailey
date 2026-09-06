const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  { ignores: ['dist/*', 'node_modules/*', 'services/*', 'packages/*', 'ios/*', 'android/*', '.expo/*'] },
]);
