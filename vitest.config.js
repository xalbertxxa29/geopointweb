import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node', // Default to node for pure logic
        globals: true,
        include: ['src/**/*.test.js', 'tests/**/*.test.js'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html'],
            include: ['src/**/*.js'],
            exclude: ['src/firebase-config.js', 'src/space-bg.js', 'src/loader.js'],
        },
    },
});
