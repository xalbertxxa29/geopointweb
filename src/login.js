import { auth } from './firebase-config';
import { signInWithEmailAndPassword, onAuthStateChanged } from "firebase/auth";

/* ── Hyperspace warp helper (same engine as the splash) ───────── */
function launchWarpAndGo(href) {
    // Build overlay
    const ov = document.createElement('div');
    ov.id = 'warp-transition';
    ov.style.cssText = `
        position:fixed;inset:0;z-index:99999;background:#020817;
        display:flex;align-items:center;justify-content:center;overflow:hidden;
        opacity:0;transition:opacity .25s ease;
    `;

    // Canvas
    const cv = document.createElement('canvas');
    cv.style.cssText = 'position:absolute;inset:0;';
    ov.appendChild(cv);

    // Glow
    const glow = document.createElement('div');
    glow.style.cssText = `
        position:absolute;width:220px;height:220px;border-radius:50%;
        background:radial-gradient(circle,rgba(0,212,255,.4) 0%,transparent 70%);
        animation:wt-glow .22s ease-in-out infinite alternate;
    `;
    ov.appendChild(glow);

    // Logo + rings wrapper
    const logoWrap = document.createElement('div');
    logoWrap.style.cssText = `
        position:relative;z-index:10;display:flex;
        align-items:center;justify-content:center;
        animation:wt-warp 2.2s cubic-bezier(.4,0,.2,1) forwards;
    `;

    // SVG rings — ultra-fast spin via inline animation
    logoWrap.innerHTML = `
        <svg style="position:absolute;inset:-60px;
                    animation:wt-spin .18s linear infinite;"
             viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg">
            <circle cx="120" cy="120" r="108" fill="none"
                    stroke="rgba(0,212,255,.55)" stroke-width="1.5"
                    stroke-dasharray="22 12"/>
            <circle cx="120" cy="120" r="86" fill="none"
                    stroke="rgba(0,255,136,.4)" stroke-width="1"
                    stroke-dasharray="40 20"/>
            <circle cx="120" cy="120" r="64" fill="none"
                    stroke="rgba(255,0,255,.35)" stroke-width="1.2"
                    stroke-dasharray="10 18"/>
            <circle cx="120" cy="120" r="108" fill="none"
                    stroke="url(#wtg)" stroke-width="4"
                    stroke-dasharray="60 620" stroke-linecap="round"/>
            <defs>
                <linearGradient id="wtg" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%"   stop-color="#00d4ff" stop-opacity="0"/>
                    <stop offset="50%"  stop-color="#00d4ff" stop-opacity="1"/>
                    <stop offset="100%" stop-color="#00d4ff" stop-opacity="0"/>
                </linearGradient>
            </defs>
        </svg>
        <img src="./imagenes/logo.png" style="
            width:120px;height:120px;object-fit:contain;position:relative;z-index:2;
            filter:drop-shadow(0 0 24px #00d4ff) drop-shadow(0 0 60px rgba(0,212,255,.6));
        "/>
    `;
    ov.appendChild(logoWrap);

    // Inject keyframes
    const kf = document.createElement('style');
    kf.textContent = `
        @keyframes wt-spin  { to { transform: rotate(360deg); } }
        @keyframes wt-glow  {
            from { transform:scale(.9); opacity:.7; }
            to   { transform:scale(1.2); opacity:1; }
        }
        @keyframes wt-warp {
            0%   { transform:translateX(0)     scale(1);    opacity:1; filter:brightness(1)  blur(0px);  }
            40%  { transform:translateX(0)     scale(1.08); opacity:1; filter:brightness(1.4) blur(0px); }
            75%  { transform:translateX(30vw)  scale(.7);   opacity:1; filter:brightness(2)   blur(2px); }
            95%  { transform:translateX(120vw) scale(.15);  opacity:.5; filter:brightness(4)  blur(8px); }
            100% { transform:translateX(160vw) scale(.05);  opacity:0;  filter:brightness(8)  blur(14px);}
        }
    `;
    document.head.appendChild(kf);
    document.body.appendChild(ov);

    // fade-in overlay immediately
    requestAnimationFrame(() => {
        requestAnimationFrame(() => { ov.style.opacity = '1'; });
    });

    // Canvas speed-lines
    const ctx = cv.getContext('2d');
    cv.width = window.innerWidth;
    cv.height = window.innerHeight;
    const W = cv.width, H = cv.height;
    const CX = W / 2, CY = H / 2;
    const COLORS = ['#00d4ff', '#00ff88', '#ffffff', '#ff00ff', '#ffe066'];
    const NUM = 220;
    const lines = Array.from({ length: NUM }, mkLine);

    function mkLine() {
        return {
            angle: Math.random() * Math.PI * 2,
            dist: Math.random() * 80 + 20,
            speed: Math.random() * 28 + 12,
            len: Math.random() * 180 + 40,
            color: COLORS[Math.floor(Math.random() * COLORS.length)],
            alpha: Math.random() * 0.7 + 0.3,
            thick: Math.random() * 1.5 + 0.3,
        };
    }

    const TOTAL = 2200;
    let t0 = null;

    function draw(ts) {
        if (!t0) t0 = ts;
        const prog = Math.min((ts - t0) / TOTAL, 1);
        const sm = 0.3 + prog * prog * 9;

        ctx.clearRect(0, 0, W, H);

        lines.forEach(l => {
            l.dist += l.speed * sm * 0.25;
            const maxD = Math.hypot(W, H);
            if (l.dist > maxD * 0.6) { Object.assign(l, mkLine()); l.dist = Math.random() * 40 + 5; }

            const x1 = CX + Math.cos(l.angle) * l.dist;
            const y1 = CY + Math.sin(l.angle) * l.dist;
            const tl = l.len * (0.2 + prog * 2.5);
            const x0 = CX + Math.cos(l.angle) * Math.max(0, l.dist - tl);
            const y0 = CY + Math.sin(l.angle) * Math.max(0, l.dist - tl);

            const g = ctx.createLinearGradient(x0, y0, x1, y1);
            g.addColorStop(0, 'transparent');
            g.addColorStop(1, l.color);

            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.lineTo(x1, y1);
            ctx.strokeStyle = g;
            ctx.globalAlpha = l.alpha * Math.min(prog * 4, 1);
            ctx.lineWidth = l.thick * (1 + prog * 1.5);
            ctx.stroke();
        });
        ctx.globalAlpha = 1;

        if (prog > 0.65) {
            const fa = (prog - 0.65) / 0.35;
            const g2 = ctx.createRadialGradient(CX, CY, 0, CX, CY, 300 * fa);
            g2.addColorStop(0, `rgba(0,212,255,${0.25 * fa})`);
            g2.addColorStop(0.4, `rgba(0,212,255,${0.08 * fa})`);
            g2.addColorStop(1, 'transparent');
            ctx.fillStyle = g2;
            ctx.fillRect(0, 0, W, H);
        }

        if (prog < 1) {
            requestAnimationFrame(draw);
        } else {
            window.location.href = href;   // ← navigate after warp completes
        }
    }

    requestAnimationFrame(draw);
}


/* ── Login logic ─────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const errorMessage = document.getElementById('error-message');
    const loginBtn = document.getElementById('login-btn');

    // ── Handle redirect errors (RBAC) ─────────────────────────────
    const urlParams = new URLSearchParams(window.location.search);
    const errCode = urlParams.get('error');
    if (errCode === 'no-profile') {
        errorMessage.textContent = 'Tu cuenta no tiene un perfil configurado en el sistema.';
    } else if (errCode === 'unauthorized-role') {
        errorMessage.textContent = 'Tu rol no tiene permisos para acceder a este panel.';
    }

    // ── Client-side rate limit: max 5 attempts per 2 minutes ──────
    const RATE_LIMIT = 5;
    const RATE_WINDOW = 2 * 60 * 1000; // 2 min in ms
    let attemptCount = 0;
    let rateResetTimer = null;

    function isRateLimited() {
        if (attemptCount >= RATE_LIMIT) return true;
        attemptCount++;
        if (!rateResetTimer) {
            rateResetTimer = setTimeout(() => {
                attemptCount = 0;
                rateResetTimer = null;
            }, RATE_WINDOW);
        }
        return false;
    }

    // Auto-redirect if already logged in (with warp)
    onAuthStateChanged(auth, (user) => {
        if (user) {
            launchWarpAndGo('menu.html');
        }
    });

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        // Rate limit check
        if (isRateLimited()) {
            errorMessage.textContent = 'Demasiados intentos. Espera 2 minutos antes de intentar de nuevo.';
            return;
        }

        // Trim inputs (prevents accidental spaces leaking)
        const email = emailInput.value.trim().toLowerCase();
        const password = passwordInput.value.trim();

        if (!email || !password) {
            errorMessage.textContent = 'Por favor completa todos los campos.';
            return;
        }

        loginBtn.disabled = true;
        loginBtn.textContent = 'VERIFICANDO...';
        errorMessage.textContent = '';

        try {
            await signInWithEmailAndPassword(auth, email, password);
            // onAuthStateChanged will fire and call launchWarpAndGo
        } catch (error) {
            // Only log to console in dev — never expose raw error to user
            if (import.meta.env.DEV) console.error('[login]', error.code, error.message);
            errorMessage.textContent = getErrorMessage(error.code);
        } finally {
            // Always re-enable button regardless of outcome
            loginBtn.disabled = false;
            loginBtn.textContent = 'INICIAR SESIÓN';
        }
    });
});

function getErrorMessage(code) {
    switch (code) {
        case 'auth/invalid-email': return 'El correo electrónico no es válido.';
        case 'auth/user-disabled': return 'Este usuario ha sido deshabilitado.';
        case 'auth/user-not-found':
        case 'auth/invalid-credential': return 'Credenciales incorrectas. Verifica tu correo y contraseña.';
        case 'auth/wrong-password': return 'La contraseña es incorrecta.';
        case 'auth/too-many-requests': return 'Demasiados intentos fallidos. Intenta más tarde.';
        default: return 'Ocurrió un error al iniciar sesión. Inténtalo de nuevo.';
    }
}
