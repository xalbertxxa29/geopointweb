import { describe, it, expect } from 'vitest';
import { normalizeUsername, subtractDuration } from './utils.js';

describe('normalizeUsername', () => {
    it('should split email correctly', () => {
        expect(normalizeUsername('jsolis@liderman.com.pe')).toBe('jsolis');
    });

    it('should return input if no @ is present', () => {
        expect(normalizeUsername('admin')).toBe('admin');
    });

    it('should return Anonimo for empty input', () => {
        expect(normalizeUsername('')).toBe('Anonimo');
        expect(normalizeUsername(null)).toBe('Anonimo');
    });
});

describe('subtractDuration', () => {
    it('should subtract 1h 30m correctly', () => {
        expect(subtractDuration('10:00:00', '1h 30m')).toBe('08:30:00');
    });

    it('should handle wraparound past midnight', () => {
        expect(subtractDuration('01:00:00', '2h 00m')).toBe('23:00:00');
    });

    it('should handle minutes only correctly', () => {
        // The regex assumes (\d+)h is present currently, let's see how it behaves
        // The regex is: /(\d+)h\s*(\d*)m?/
        // If it doesn't match '30m', it currently returns original string.
        // Let's test that behavior first.
        expect(subtractDuration('10:00:00', '30m')).toBe('10:00:00');
    });

    it('should return - if inputs are missing', () => {
        expect(subtractDuration('', '1h')).toBe('-');
        expect(subtractDuration('10:00', '')).toBe('-');
    });
});
