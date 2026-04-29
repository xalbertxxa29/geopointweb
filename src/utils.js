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
/**
 * Formats a Date object or Firestore Timestamp to dd/mm/yyyy hh:mm:ss (Peru Time)
 * @param {Date|Object} input 
 * @returns {string}
 */
export function formatDate(input) {
    if (!input) return 'N/A';
    
    let d = input;
    // Handle Firestore Timestamp
    if (input && typeof input.toDate === 'function') {
        d = input.toDate();
    } else if (!(input instanceof Date)) {
        d = new Date(input);
    }
    
    if (isNaN(d.getTime())) return 'N/A';
    
    // Explicitly use America/Lima (Peru) timezone
    const formatter = new Intl.DateTimeFormat('es-PE', {
        timeZone: 'America/Lima',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });

    const parts = formatter.formatToParts(d);
    const getPart = (type) => parts.find(p => p.type === type).value;

    return `${getPart('day')}/${getPart('month')}/${getPart('year')} ${getPart('hour')}:${getPart('minute')}:${getPart('second')}`;
}

/**
 * Parses a string in format dd/mm/yyyy hh:mm:ss back to a Date object, 
 * interpreting it as Peru Time (UTC-5).
 * @param {string} dateStr 
 * @returns {Date|string}
 */
export function parseDate(dateStr) {
    if (typeof dateStr !== 'string') return dateStr;
    const regex = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/;
    const match = dateStr.match(regex);
    if (match) {
        const [_, day, month, year, hours, minutes, seconds] = match;
        // Peru is UTC-5 (no DST)
        const isoStr = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}:${seconds.padStart(2, '0')}-05:00`;
        const d = new Date(isoStr);
        if (!isNaN(d.getTime())) return d;
    }
    return dateStr;
}
