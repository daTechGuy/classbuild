import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // The React plugin handles the JSX transform so component tests (.test.tsx)
  // don't need an explicit `import React from 'react'`.
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    globals: false,
    setupFiles: ['tests/setup.ts'],
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    server: { deps: { inline: ['jszip', 'mammoth'] } },
    coverage: {
      provider: 'v8',
      // text-summary prints to the console; html is browsable locally and
      // uploaded as a CI artifact; lcov is the Codecov/Coveralls format
      // (kept around so we can wire one of those services later without
      // touching the config); json-summary feeds a possible future badge.
      reporter: ['text-summary', 'html', 'lcov', 'json-summary'],
      include: ['src/**'],
      exclude: [
        '**/*.test.ts',
        '**/*.test.tsx',
        // Type-only files — instrumenting these is noise.
        'src/types/**',
        // Top-level entry & shell glue is exercised by manual smoke, not unit
        // tests; instrument the slices that have unit coverage instead.
        'src/main.tsx',
        'src/App.tsx',
        'src/themes.ts',
      ],
    },
  },
});
