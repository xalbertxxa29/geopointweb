/**
 * loader.js  — Global neon-orbital loading overlay
 * Usage:
 *   import { showLoader, hideLoader } from './loader.js';
 *   showLoader('Cargando datos...');
 *   hideLoader();
 */

let _overlay = null;
let _msgEl = null;
let _hideRef = null;

function buildOverlay() {
    if (document.getElementById('gl-overlay')) return;

    const el = document.createElement('div');
    el.id = 'gl-overlay';
    el.innerHTML = `
        <div class="gl-scene">
            <!-- Orbital rings -->
            <svg class="gl-rings" viewBox="0 0 260 260" xmlns="http://www.w3.org/2000/svg">
                <!-- Ring 1 — cyan -->
                <circle class="gl-ring gl-ring-1" cx="130" cy="130" r="100"
                        fill="none" stroke="url(#g1)" stroke-width="2"
                        stroke-dasharray="80 550" stroke-linecap="round"/>
                <!-- Ring 2 — neon green -->
                <circle class="gl-ring gl-ring-2" cx="130" cy="130" r="80"
                        fill="none" stroke="url(#g2)" stroke-width="1.5"
                        stroke-dasharray="50 450" stroke-linecap="round"/>
                <!-- Ring 3 — magenta -->
                <circle class="gl-ring gl-ring-3" cx="130" cy="130" r="118"
                        fill="none" stroke="url(#g3)" stroke-width="1"
                        stroke-dasharray="30 700" stroke-linecap="round"/>
                <!-- Particle dots on ring 1 -->
                <circle class="gl-dot gl-dot-1" cx="230" cy="130" r="4" fill="#00d4ff"/>
                <circle class="gl-dot gl-dot-2" cx="130" cy="30"  r="3" fill="#00ff88"/>
                <circle class="gl-dot gl-dot-3" cx="30"  cy="130" r="2.5" fill="#ff00ff"/>
                <defs>
                    <linearGradient id="g1" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%"   stop-color="#00d4ff" stop-opacity="0"/>
                        <stop offset="60%"  stop-color="#00d4ff" stop-opacity="1"/>
                        <stop offset="100%" stop-color="#00d4ff" stop-opacity="0"/>
                    </linearGradient>
                    <linearGradient id="g2" x1="100%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%"   stop-color="#00ff88" stop-opacity="0"/>
                        <stop offset="60%"  stop-color="#00ff88" stop-opacity="0.9"/>
                        <stop offset="100%" stop-color="#00ff88" stop-opacity="0"/>
                    </linearGradient>
                    <linearGradient id="g3" x1="0%" y1="100%" x2="100%" y2="0%">
                        <stop offset="0%"   stop-color="#d400ff" stop-opacity="0"/>
                        <stop offset="60%"  stop-color="#ff00ff" stop-opacity="0.8"/>
                        <stop offset="100%" stop-color="#d400ff" stop-opacity="0"/>
                    </linearGradient>
                </defs>
            </svg>

            <!-- Logo -->
            <div class="gl-logo-wrap">
                <img class="gl-logo" src="./imagenes/logo.webp" alt="Logo">
                <div class="gl-logo-glow"></div>
            </div>
        </div>

        <!-- Message -->
        <p class="gl-msg" id="gl-msg">Cargando...</p>

        <!-- Stars backdrop (tiny dots) -->
        <div class="gl-stars"></div>
    `;
    document.body.appendChild(el);
    _overlay = el;
    _msgEl = el.querySelector('#gl-msg');

    // Generate random stars
    const stars = el.querySelector('.gl-stars');
    for (let i = 0; i < 60; i++) {
        const s = document.createElement('span');
        s.style.cssText = `
            position:absolute;
            width:${Math.random() * 2 + 1}px; height:${Math.random() * 2 + 1}px;
            border-radius:50%; opacity:${Math.random() * .6 + .1};
            background:${['#00d4ff', '#00ff88', '#ffffff', '#ff00ff'][Math.floor(Math.random() * 4)]};
            top:${Math.random() * 100}%; left:${Math.random() * 100}%;
            animation: gl-twinkle ${Math.random() * 3 + 2}s infinite ${Math.random() * 2}s alternate;
        `;
        stars.appendChild(s);
    }
}

/**
 * Show the global loader overlay.
 * @param {string} [msg='Cargando...']  - Text shown below the orbital logo.
 */
export function showLoader(msg = 'Cargando...') {
    if (!document.getElementById('gl-overlay')) buildOverlay();
    else {
        _overlay = document.getElementById('gl-overlay');
        _msgEl = _overlay.querySelector('#gl-msg');
    }
    if (_msgEl) _msgEl.textContent = msg;
    _overlay.classList.add('gl-visible');
    document.body.style.overflow = 'hidden';
    if (_hideRef) clearTimeout(_hideRef);
}

/**
 * Hide the global loader overlay (with fade-out).
 * @param {number} [delay=0]  - Optional delay in ms before hiding.
 */
export function hideLoader(delay = 0) {
    const target = _overlay || document.getElementById('gl-overlay');
    if (!target) return;
    _hideRef = setTimeout(() => {
        target.classList.remove('gl-visible');
        document.body.style.overflow = '';
    }, delay);
}
