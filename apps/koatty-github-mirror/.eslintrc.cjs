module.exports = {
  root: true, parser: '@typescript-eslint/parser', plugins: ['@typescript-eslint'],
  env: { node: true, es2022: true },
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] },
};
