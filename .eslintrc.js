module.exports =  {
    parser:  '@typescript-eslint/parser', // Specifies the ESLint parser
    extends:  [
        'plugin:@typescript-eslint/recommended', // Uses the recommended rules from the @typescript-eslint/eslint-plugin
        'prettier/@typescript-eslint', // Uses eslint-config-prettier to disable ESLint rules from @typescript-eslint/eslint-plugin that would conflict with prettier
        'plugin:prettier/recommended' // Enables eslint-plugin-prettier and displays prettier errors as ESLint errors. Make sure this is always the last configuration in the extends array.
    ],
    parserOptions:  {
        ecmaVersion:  2018,  // Allows for the parsing of modern ECMAScript features
        sourceType:  'module'  // Allows for the use of imports
    },
    rules: {
        'prettier/prettier': 'warn',
        '@typescript-eslint/array-type': ['warning', 'array-simple'],
        '@typescript-eslint/camelcase': 'off',
        '@typescript-eslint/explicit-member-accessibility': ['error', {
            accessibility: 'explicit', // accessibilty must be explicit
            overrides: {
                constructors: 'no-public' // ...except for public constructors
            }
        }],
        '@typescript-eslint/no-use-before-define': 'warn',
        '@typescript-eslint/no-non-null-assertion': 'off',
        '@typescript-eslint/no-parameter-properties': 'off',
        '@typescript-eslint/interface-name-prefix': ['warning', 'always'], // interfaces should have the 'I' prefix
          '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/explicit-function-return-type': ['warning', {
          'allowExpressions': true,
          'allowTypedFunctionExpressions': true
        }],
        '@typescript-eslint/no-unused-vars': ['warning', {
            'varsIgnorePattern': '[_]' // disable the rule if the variable name is _
        }]
    }
}