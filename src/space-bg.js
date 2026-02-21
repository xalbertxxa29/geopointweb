/**
 * space-bg.js
 * Animated space canvas: stars, constellations, shooting stars, nebula.
 * Call initSpaceBg() once DOMContentLoaded.
 */
export function initSpaceBg() {
    // Create canvas
    const canvas = document.createElement('canvas');
    canvas.id = 'space-canvas';
    document.body.prepend(canvas);
    const ctx = canvas.getContext('2d');

    let W, H;
    const STAR_COUNT = 200;
    const CONSTELLATION_N = 18;   // nodes for constellation
    const SHOOTING_INTERVAL = 3200; // ms between shooting stars

    /* ─── Resize ────────────────────────────────────────────── */
    function resize() {
        W = canvas.width = window.innerWidth;
        H = canvas.height = window.innerHeight;
        buildStars();
        buildConstellations();
    }

    /* ─── Stars ─────────────────────────────────────────────── */
    let stars = [];
    function buildStars() {
        stars = Array.from({ length: STAR_COUNT }, () => ({
            x: Math.random() * W,
            y: Math.random() * H,
            r: Math.random() * 1.4 + 0.2,
            alpha: Math.random() * 0.6 + 0.2,
            speed: Math.random() * 0.003 + 0.001,   // twinkle speed
            phase: Math.random() * Math.PI * 2,
        }));
    }
    function drawStars(t) {
        stars.forEach(s => {
            const a = s.alpha + Math.sin(t * s.speed + s.phase) * 0.25;
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(180,230,255,${Math.max(0, a)})`;
            ctx.fill();
        });
    }

    /* ─── Constellations ─────────────────────────────────────── */
    // Two rotating constellation groups
    let constellations = [];
    function buildConstellations() {
        constellations = [
            makeConstellation(W * 0.22, H * 0.28, 130, CONSTELLATION_N, 0.00012, 'rgba(0,212,255,'),
            makeConstellation(W * 0.78, H * 0.68, 100, 12, 0.00008, 'rgba(0,212,255,'),
            makeConstellation(W * 0.55, H * 0.45, 80, 8, 0.00015, 'rgba(255,23,68,'),
        ];
    }
    function makeConstellation(cx, cy, radius, n, speed, colorBase) {
        const nodes = Array.from({ length: n }, (_, i) => {
            const angle = (i / n) * Math.PI * 2 + Math.random() * 0.5;
            const r = radius * (0.4 + Math.random() * 0.6);
            return { ax: Math.cos(angle) * r, ay: Math.sin(angle) * r };
        });
        // Build edges: each node connects to 2-3 nearest neighbours
        const edges = [];
        nodes.forEach((a, i) => {
            const dists = nodes
                .map((b, j) => ({ j, d: Math.hypot(a.ax - b.ax, a.ay - b.ay) }))
                .filter(e => e.j !== i)
                .sort((x, y) => x.d - y.d)
                .slice(0, 2);
            dists.forEach(e => edges.push([i, e.j]));
        });
        return { cx, cy, radius, nodes, edges, angle: Math.random() * Math.PI * 2, speed, colorBase };
    }
    function drawConstellations(t) {
        constellations.forEach(c => {
            c.angle += c.speed;
            const cos = Math.cos(c.angle), sin = Math.sin(c.angle);
            // Transform nodes
            const pts = c.nodes.map(n => ({
                x: c.cx + n.ax * cos - n.ay * sin,
                y: c.cy + n.ax * sin + n.ay * cos,
            }));
            // Lines
            c.edges.forEach(([i, j]) => {
                const a = pts[i], b = pts[j];
                const dist = Math.hypot(a.x - b.x, a.y - b.y);
                const opacity = Math.max(0, 0.18 - dist / 1200);
                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(b.x, b.y);
                ctx.strokeStyle = c.colorBase + opacity + ')';
                ctx.lineWidth = 0.6;
                ctx.stroke();
            });
            // Nodes (dots)
            pts.forEach(p => {
                ctx.beginPath();
                ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2);
                ctx.fillStyle = c.colorBase + '0.55)';
                ctx.fill();
            });
        });
    }

    /* ─── Shooting Stars ─────────────────────────────────────── */
    let shooters = [];
    function spawnShooter() {
        const angle = (Math.random() * 30 + 20) * (Math.PI / 180); // 20-50 deg
        const speed = Math.random() * 6 + 5;
        shooters.push({
            x: Math.random() * W * 0.8,
            y: Math.random() * H * 0.3,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            len: Math.random() * 120 + 80,
            alpha: 1,
            decay: Math.random() * 0.015 + 0.012,
        });
    }
    setInterval(spawnShooter, SHOOTING_INTERVAL);
    // Random extra burst occasionally
    setInterval(() => { if (Math.random() > 0.5) spawnShooter(); }, SHOOTING_INTERVAL * 1.7);

    function drawShooters() {
        shooters = shooters.filter(s => s.alpha > 0);
        shooters.forEach(s => {
            const tailX = s.x - s.vx * (s.len / (s.len * 0.1 + 1));
            const tailY = s.y - s.vy * (s.len / (s.len * 0.1 + 1));
            const grad = ctx.createLinearGradient(tailX, tailY, s.x, s.y);
            grad.addColorStop(0, `rgba(0,212,255,0)`);
            grad.addColorStop(0.7, `rgba(180,240,255,${s.alpha * 0.6})`);
            grad.addColorStop(1, `rgba(255,255,255,${s.alpha})`);
            ctx.beginPath();
            ctx.moveTo(tailX, tailY);
            ctx.lineTo(s.x, s.y);
            ctx.strokeStyle = grad;
            ctx.lineWidth = 1.5;
            ctx.stroke();
            // head glow
            ctx.beginPath();
            ctx.arc(s.x, s.y, 2, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255,255,255,${s.alpha})`;
            ctx.fill();
            s.x += s.vx;
            s.y += s.vy;
            s.alpha -= s.decay;
        });
    }

    /* ─── Nebula glow (very subtle) ─────────────────────────── */
    function drawNebula(t) {
        const r1 = ctx.createRadialGradient(
            W * 0.15 + Math.sin(t * 0.0003) * 40,
            H * 0.25 + Math.cos(t * 0.0002) * 30,
            0,
            W * 0.15, H * 0.25, W * 0.35
        );
        r1.addColorStop(0, 'rgba(0,60,120,0.07)');
        r1.addColorStop(1, 'transparent');
        ctx.fillStyle = r1;
        ctx.fillRect(0, 0, W, H);

        const r2 = ctx.createRadialGradient(
            W * 0.85 + Math.cos(t * 0.0002) * 40,
            H * 0.75 + Math.sin(t * 0.0003) * 30,
            0,
            W * 0.85, H * 0.75, W * 0.3
        );
        r2.addColorStop(0, 'rgba(100,0,30,0.05)');
        r2.addColorStop(1, 'transparent');
        ctx.fillStyle = r2;
        ctx.fillRect(0, 0, W, H);
    }

    /* ─── Render loop ────────────────────────────────────────── */
    let frame = 0;
    function render(t) {
        ctx.clearRect(0, 0, W, H);
        drawNebula(t);
        drawStars(t);
        drawConstellations(t);
        drawShooters();
        requestAnimationFrame(render);
    }

    window.addEventListener('resize', resize);
    resize();
    requestAnimationFrame(render);
}
