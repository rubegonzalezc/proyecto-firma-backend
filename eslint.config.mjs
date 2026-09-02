import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

/**
 * El script `lint` existía en package.json pero no había configuración, así que
 * nunca llegó a ejecutarse. Configuración plana equivalente a la del frontend.
 */
export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
    rules: {
      // Nest usa decoradores e inyección: los tipos any de las librerías de
      // terceros aparecen en las fronteras y no aportan marcarlos uno a uno.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
