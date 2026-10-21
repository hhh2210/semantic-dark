import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,mjs}'],
    coverage: {reporter: ['text', 'html']},
    server: {deps: {inline: ['@material/material-color-utilities']}},
  },
});
