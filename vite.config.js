import { defineConfig } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig(({ command }) => ({
    // ── GitHub Pages base path ──────────────────────────────────────
    // Change 'geopointweb' to whatever you name your GitHub repository
    base: command === 'build' ? '/geopointweb/' : '/',

    build: {
        outDir: 'dist',
        rollupOptions: {
            input: {
                main: resolve(__dirname, 'index.html'),
                menu: resolve(__dirname, 'menu.html'),
            },
            output: {
                manualChunks(id) {
                    if (id.includes('node_modules')) {
                        if (id.includes('firebase')) return 'vendor-firebase';
                        if (id.includes('chart.js')) return 'vendor-charts';
                        if (id.includes('jspdf') || id.includes('html2canvas')) return 'vendor-pdf';
                        if (id.includes('leaflet') || id.includes('maplibre-gl')) return 'vendor-maps';
                        return 'vendor';
                    }
                }
            }
        },
    },
}));
