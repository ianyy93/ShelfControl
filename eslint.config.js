import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';
import tseslint from 'typescript-eslint';

export default [
  {
    ignores: ['dist/**/*']
  },
  ...tseslint.configs.recommended,
  firebaseRulesPlugin.configs['flat/recommended'],
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off"
    }
  }
];
