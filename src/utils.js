/**
 * Utility functions for the GeoPoint Web App
 */

/**
 * Normalizes a username from a string (likely an email)
 * @param {string} input 
 * @returns {string}
 */
export function normalizeUsername(input) {
    if (!input) return 'Anonimo';
    return input.split('@')[0];
}

/**
 * Calculates a start hour by subtracting a duration string from an end hour
 * @param {string} horaFin - Format 'HH:mm:ss' or 'HH:mm'
 * @param {string} duracion - Format '1h 38m'
 * @returns {string} - Format 'HH:mm:ss'
 */
export function subtractDuration(horaFin, duracion) {
    if (!horaFin || !duracion) return '-';
    try {
        const parts = horaFin.split(':').map(Number);
        const h = parts[0] || 0;
        const m = parts[1] || 0;
        const s = parts[2] || 0;

        const match = duracion.match(/(\d+)h\s*(\d*)m?/);
        if (!match) return horaFin;

        const dh = parseInt(match[1]) || 0;
        const dm = parseInt(match[2]) || 0;

        let totalMin = h * 60 + m - (dh * 60 + dm);
        if (totalMin < 0) totalMin += 24 * 60;

        const rh = Math.floor(totalMin / 60).toString().padStart(2, '0');
        const rm = (totalMin % 60).toString().padStart(2, '0');
        const rs = s.toString().padStart(2, '0');

        return `${rh}:${rm}:${rs}`;
    } catch (e) {
        return horaFin;
    }
}

/**
 * Generates a consistent neon color palette
 */
export const NEON_PALETTE = [
    '#00d4ff', // Cyan
    '#ff1744', // Red
    '#00e676', // Green
    '#ffea00', // Yellow
    '#d500f9', // Purple
    '#3d5afe', // Blue
    '#ff9100', // Orange
    '#00b0ff', // Light Blue
];
