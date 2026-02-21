import { auth, db } from './firebase-config';
import { onAuthStateChanged, signOut, sendPasswordResetEmail } from "firebase/auth";
import { collection, getDocs, doc, updateDoc, deleteDoc, getDoc } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { showLoader, hideLoader } from './loader.js';


import Chart from 'chart.js/auto';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';


// Register datalabels globally (used in all charts)
Chart.register(ChartDataLabels);


document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const mainContent = document.querySelector('.main-content');
    const displayUsername = document.getElementById('display-username');

    // Dashboard Elements
    const filterSection = document.getElementById('filter-section');
    const indicatorsGrid = document.getElementById('indicators-grid');
    const tableSection = document.getElementById('table-section');
    const loadingDiv = document.getElementById('loading');
    const logoutBtn = document.getElementById('logout-btn');
    const tableBody = document.getElementById('table-body');

    // Filter Controls
    const dateStart = document.getElementById('date-start');
    const dateEnd = document.getElementById('date-end');
    const filterClient = document.getElementById('filter-client');
    const filterUnit = document.getElementById('filter-unit');
    const filterUser = document.getElementById('filter-user'); // New User Filter
    const applyBtn = document.getElementById('apply-filters');

    // View References
    const dashboardView = document.getElementById('indicators-grid');
    const reportsView = document.getElementById('reports-view');
    const reportsTableBody = document.getElementById('reports-table-body');
    const navLinks = document.querySelectorAll('.nav-link');

    // Chart References
    let charts = {
        client: null,
        unit: null,
        user: null
    };

    // Data Store
    let rawData = [];
    let currentView = 'dashboard'; // 'dashboard' or 'reportes'

    // --- Sidebar Logic ---
    sidebarToggle.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
    });

    // --- Navigation Logic ---
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            // Remove active class from all
            document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

            // Add active to parent li
            const parentLi = link.closest('.nav-item');
            parentLi.classList.add('active');

            const linkText = link.querySelector('.link-text').textContent;

            if (linkText === 'Dashboard') {
                currentView = 'dashboard';
                dashboardView.style.display = 'grid';
                tableSection.style.display = 'block';
                reportsView.style.display = 'none';
                filterSection.style.display = 'block';
                document.getElementById('units-view').style.display = 'none';
            } else if (linkText === 'Reportes') {
                currentView = 'reportes';
                dashboardView.style.display = 'none';
                tableSection.style.display = 'none';
                reportsView.style.display = 'block';
                filterSection.style.display = 'block';
                document.getElementById('units-view').style.display = 'none';
                updateReportsTable(getFilteredData());
            } else if (linkText === 'Gestión') {
                currentView = 'gestion';
                dashboardView.style.display = 'none';
                tableSection.style.display = 'none';
                reportsView.style.display = 'none';
                filterSection.style.display = 'none';
                document.getElementById('units-view').style.display = 'block';
                document.getElementById('usuarios-view').style.display = 'none';
            } else if (linkText === 'Usuarios') {
                currentView = 'usuarios';
                dashboardView.style.display = 'none';
                tableSection.style.display = 'none';
                reportsView.style.display = 'none';
                filterSection.style.display = 'none';
                document.getElementById('units-view').style.display = 'none';
                document.getElementById('usuarios-view').style.display = 'block';
            } else {
                currentView = 'other';
                dashboardView.style.display = 'none';
                tableSection.style.display = 'none';
                reportsView.style.display = 'none';
                filterSection.style.display = 'none';
                document.getElementById('units-view').style.display = 'none';
                document.getElementById('usuarios-view').style.display = 'none';
            }
        });
    });

    // --- Authentication & Data Fetching ---
    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            window.location.href = 'index.html';
        } else {
            // Set User Display
            displayUsername.textContent = user.displayName || user.email.split('@')[0];

            showLoader('Sincronizando datos...');
            try {
                const snapshot = await getDocs(collection(db, "tareas"));
                rawData = snapshot.docs.map(doc => {
                    const d = doc.data();
                    return {
                        id: doc.id,
                        ...d,
                        // Normalization
                        userName: (d.userName || d.userEmail || 'Anonimo').split('@')[0],
                        date: d.fecha ? new Date(d.fecha) : null,
                        cliente: d.cliente || 'Sin Asignar',
                        unidad: d.unidad || 'General',
                        descripcion: d.descripcion || '-',
                        tiempoEstadia: d.tiempoEstadia || '-',
                        estado: d.estado || 'Pendiente'
                    };
                });

                populateFilters();
                refreshDashboard();

                // Reveal UI (Default Dashboard)
                loadingDiv.style.display = 'none';
                filterSection.style.display = 'block';
                dashboardView.style.display = 'grid';
                tableSection.style.display = 'block';
                reportsView.style.display = 'none';

                hideLoader(300);

            } catch (err) {
                console.error("Data Load Error:", err);
                hideLoader();
                loadingDiv.innerHTML = `<i class='bx bxs-error-circle'></i> Error al cargar datos: ${err.message}`;
            }
        }
    });


    // --- Logout ---
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            await signOut(auth);
            window.location.href = 'index.html';
        });
    }

    // --- Filters ---
    applyBtn.addEventListener('click', () => {
        showLoader('Aplicando filtros...');
        setTimeout(() => { refreshDashboard(); hideLoader(400); }, 100);
    });

    function populateFilters() {
        const clients = [...new Set(rawData.map(i => i.cliente))].sort();
        const users = [...new Set(rawData.map(i => i.userName))].sort();

        // ── Populate Clients ──────────────────────────────────────
        clients.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c; opt.textContent = c;
            filterClient.appendChild(opt);
        });

        // ── Populate Users ────────────────────────────────────────
        users.forEach(u => {
            const opt = document.createElement('option');
            opt.value = u; opt.textContent = u;
            filterUser.appendChild(opt);
        });

        // ── Initial Unit population (all units) ───────────────────
        populateUnits('');

        // ── Cascade: rebuild units when client changes ────────────
        filterClient.addEventListener('change', () => {
            populateUnits(filterClient.value);
            filterUnit.value = ''; // reset unit selection
        });
    }

    function populateUnits(selectedClient) {
        // Keep only the default "Todas las Unidades" option
        filterUnit.innerHTML = '<option value="">Todas las Unidades</option>';

        const source = selectedClient
            ? rawData.filter(i => i.cliente === selectedClient)
            : rawData;

        const units = [...new Set(source.map(i => i.unidad))].sort();

        units.forEach(u => {
            const opt = document.createElement('option');
            opt.value = u; opt.textContent = u;
            filterUnit.appendChild(opt);
        });
    }

    function getFilteredData() {
        const startDate = dateStart.value ? new Date(dateStart.value) : null;
        let endDate = dateEnd.value ? new Date(dateEnd.value) : null;
        if (endDate) endDate.setHours(23, 59, 59);

        return rawData.filter(item => {
            if (startDate && item.date && item.date < startDate) return false;
            if (endDate && item.date && item.date > endDate) return false;
            if (filterClient.value && item.cliente !== filterClient.value) return false;
            if (filterUnit.value && item.unidad !== filterUnit.value) return false;
            if (filterUser.value && item.userName !== filterUser.value) return false; // User Filter
            return true;
        });
    }

    function refreshDashboard() {
        const filtered = getFilteredData();

        if (currentView === 'dashboard') {
            // 2. Aggregate Data
            const counts = {
                clients: {},
                units: {},
                users: {}
            };

            filtered.forEach(item => {
                counts.clients[item.cliente] = (counts.clients[item.cliente] || 0) + 1;
                counts.units[item.unidad] = (counts.units[item.unidad] || 0) + 1;
                counts.users[item.userName] = (counts.users[item.userName] || 0) + 1;
            });

            // 3. Update Visuals
            updateCharts(counts);
            updateTable(filtered);
        } else if (currentView === 'reportes') {
            updateReportsTable(filtered);
        }
    }

    // ─── Pagination state for Registro Detallado ────────────────
    let tableCurrentPage = 1;
    const TABLE_PAGE_SIZE = 10;
    let tableDataCache = [];

    function updateTable(data) {
        tableDataCache = data;
        tableCurrentPage = 1;
        renderTablePage();
    }

    function renderTablePage() {
        const data = tableDataCache;
        const total = data.length;
        const pages = Math.max(1, Math.ceil(total / TABLE_PAGE_SIZE));
        const page = Math.min(tableCurrentPage, pages);
        const start = (page - 1) * TABLE_PAGE_SIZE;
        const slice = data.slice(start, start + TABLE_PAGE_SIZE);

        // ── Rows ──────────────────────────────────────────────────
        tableBody.innerHTML = '';

        if (total === 0) {
            tableBody.innerHTML = `
                <tr><td colspan="7" style="text-align:center;padding:28px;color:var(--text-dim);">
                    <i class='bx bx-search-alt' style="font-size:1.5rem;display:block;margin-bottom:8px;"></i>
                    No se encontraron registros
                </td></tr>`;
        } else {
            slice.forEach(row => {
                const isOk = row.estado && row.estado.toUpperCase().includes('COMPLET');
                const statusColor = isOk ? '#00d4ff' : '#ff1744';
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${row.date ? row.date.toLocaleDateString('es-PE') : 'N/A'}</td>
                    <td style="font-weight:600;color:#e8f4ff;">${row.cliente}</td>
                    <td>${row.unidad}</td>
                    <td><i class='bx bx-user' style="margin-right:5px;color:var(--primary);vertical-align:middle;"></i>${row.userName}</td>
                    <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${row.descripcion}">${row.descripcion}</td>
                    <td style="color:var(--primary);font-family:monospace;">${row.tiempoEstadia}</td>
                    <td><span style="color:${statusColor};border:1px solid ${statusColor};padding:2px 10px;border-radius:20px;font-size:.72rem;letter-spacing:.5px;white-space:nowrap;">${row.estado}</span></td>
                `;
                tableBody.appendChild(tr);
            });
        }

        // ── Pagination controls ───────────────────────────────────
        let pager = document.getElementById('table-pager');
        if (!pager) {
            pager = document.createElement('div');
            pager.id = 'table-pager';
            pager.className = 'table-pager';
            // Insert after the table-responsive div inside #table-section
            const tableSection = document.getElementById('table-section');
            tableSection.appendChild(pager);
        }

        if (total === 0) { pager.innerHTML = ''; return; }

        const btn = (label, disabled, action, icon = '') => `
            <button class="pager-btn${disabled ? ' disabled' : ''}" ${disabled ? 'disabled' : `onclick="${action}"`}>
                ${icon ? `<i class='bx ${icon}'></i>` : label}
            </button>`;

        // generate page number buttons (max 5 visible)
        let pageButtons = '';
        const range = 2; // pages on each side of current
        for (let p = 1; p <= pages; p++) {
            if (p === 1 || p === pages || (p >= page - range && p <= page + range)) {
                pageButtons += `<button class="pager-btn${p === page ? ' active' : ''}" onclick="window._tablePage(${p})">${p}</button>`;
            } else if (p === page - range - 1 || p === page + range + 1) {
                pageButtons += `<span class="pager-ellipsis">…</span>`;
            }
        }

        pager.innerHTML = `
            <div class="pager-info">
                Mostrando <strong>${start + 1}–${Math.min(start + TABLE_PAGE_SIZE, total)}</strong> de <strong>${total}</strong> registros
            </div>
            <div class="pager-controls">
                ${btn('', page <= 1, '', 'bx-first-page')}
                ${btn('', page <= 1, '', 'bx-chevron-left')}
                ${pageButtons}
                ${btn('', page >= pages, '', 'bx-chevron-right')}
                ${btn('', page >= pages, '', 'bx-last-page')}
            </div>`;

        // Wire up icon buttons (since onclick='' with disabled won't work for first/last)
        const btns = pager.querySelectorAll('.pager-btn:not(.active):not(.disabled)');
        const icons = ['bx-first-page', 'bx-chevron-left', 'bx-chevron-right', 'bx-last-page'];
        const actions = [1, page - 1, page + 1, pages];
        btns.forEach((b, i) => {
            const icon = b.querySelector('i');
            if (!icon) return;
            const idx = icons.indexOf(icon.classList[1]);
            if (idx >= 0) b.onclick = () => window._tablePage(actions[idx]);
        });
    }

    // Global helper for onclick in innerHTML pagination buttons
    window._tablePage = (p) => {
        tableCurrentPage = p;
        renderTablePage();
    };



    function updateReportsTable(data) {
        reportsTableBody.innerHTML = '';

        data.forEach(row => {
            const tr = document.createElement('tr');
            const statusColor = row.estado === 'COMPLETADA' ? '#00f3ff' : '#ff003c';

            tr.innerHTML = `
                <td>${row.date ? row.date.toLocaleDateString() : 'N/A'}</td>
                <td style="font-weight: 600; color: #fff;">${row.cliente}</td>
                <td>${row.unidad}</td>
                <td>${row.userName}</td>
                <td>${row.descripcion}</td>
                <td style="color: var(--primary); font-family: monospace;">${row.tiempoEstadia}</td>
                <td><span style="color: ${statusColor}; border: 1px solid ${statusColor}; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem;">${row.estado}</span></td>
                <td class="action-cell">
                    <button class="icon-btn view-btn" title="Ver Detalles"><i class='bx bx-show'></i></button>
                    <button class="icon-btn pdf-btn" title="Descargar PDF" onclick="generatePDF('${row.id}')"><i class='bx bxs-file-pdf'></i></button>
                </td>
            `;
            reportsTableBody.appendChild(tr);
        });

        if (data.length === 0) {
            reportsTableBody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding: 20px;">No se encontraron registros para generar reporte</td></tr>`;
        }
    }

    // --- PDF Generation ---
    window.generatePDF = async (id) => {
        // Find the task in loaded data
        const task = rawData.find(r => r.id === id);
        if (!task) return;

        // Show loading feedback
        const btn = document.querySelector(`[onclick="generatePDF('${id}')"]`);
        if (btn) { btn.innerHTML = `<i class='bx bx-loader-alt bx-spin'></i>`; btn.disabled = true; }

        try {
            // Fetch actividades sub-collection
            const actSnap = await getDocs(collection(doc(db, 'tareas', id), 'actividades'));
            const actividades = actSnap.docs.map(d => d.data());

            // Sort by hora
            actividades.sort((a, b) => (a.hora || '').localeCompare(b.hora || ''));

            // Group by tipoCode
            const grupos = {};
            actividades.forEach(act => {
                const tipo = act.tipoCode || act.tipo || 'otro';
                if (!grupos[tipo]) grupos[tipo] = [];
                grupos[tipo].push(act);
            });

            // Config PDF
            const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
            const W = pdf.internal.pageSize.getWidth();
            const ROJO = [196, 30, 58];
            const GRIS = [240, 240, 240];
            const TEXTO = [30, 30, 30];

            // ---- HEADER ----
            // Load logo as base64
            let logoBase64 = null;
            try {
                const resp = await fetch('./imagenes/logo.png');
                const blob = await resp.blob();
                logoBase64 = await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.readAsDataURL(blob);
                });
            } catch (e) { logoBase64 = null; }

            // Logo (left) — smaller so it doesn't overlap title
            if (logoBase64) {
                pdf.addImage(logoBase64, 'PNG', 10, 8, 28, 22);
            } else {
                pdf.setFillColor(...ROJO);
                pdf.rect(10, 8, 28, 22, 'F');
                pdf.setTextColor(255, 255, 255);
                pdf.setFontSize(10);
                pdf.setFont('helvetica', 'bold');
                pdf.text('LIDERMAN', 24, 21, { align: 'center' });
            }

            // Info boxes top right (narrower, 65mm wide)
            const infoX = W - 70;
            pdf.setFontSize(8);
            pdf.setFont('helvetica', 'bold');
            pdf.setFillColor(...GRIS);
            pdf.rect(infoX, 8, 65, 7, 'F');
            pdf.setTextColor(...TEXTO);
            pdf.text('Versión:', infoX + 2, 13);
            pdf.setFont('helvetica', 'normal');
            pdf.text('LiderControl V.1', infoX + 20, 13);

            pdf.setFillColor(...GRIS);
            pdf.rect(infoX, 16, 65, 7, 'F');
            pdf.setFont('helvetica', 'bold');
            pdf.text('Sede:', infoX + 2, 21);
            pdf.setFont('helvetica', 'normal');
            const sedeStr = String(task.unidad || '-');
            pdf.text(sedeStr.length > 22 ? sedeStr.substring(0, 22) + '…' : sedeStr, infoX + 20, 21);

            pdf.setFillColor(...GRIS);
            pdf.rect(infoX, 24, 65, 7, 'F');
            pdf.setFont('helvetica', 'bold');
            pdf.text('Fecha:', infoX + 2, 29);
            pdf.setFont('helvetica', 'normal');
            pdf.text(task.finalizacionFecha || (task.date ? task.date.toLocaleDateString() : '-'), infoX + 20, 29);

            // Title — centered in the space between logo (ends at 40) and infoX
            const titleZoneCenter = (40 + infoX) / 2;
            pdf.setTextColor(...TEXTO);
            pdf.setFontSize(14);
            pdf.setFont('helvetica', 'bold');
            pdf.text('REPORTE DE VISITAS', titleZoneCenter, 21, { align: 'center' });

            // Thin separator line
            pdf.setDrawColor(200, 200, 200);
            pdf.line(10, 33, W - 10, 33);

            // ---- SECCIÓN 1: DETALLE GENERAL ----
            let y = 38;
            pdf.setFillColor(...ROJO);
            pdf.rect(10, y, W - 20, 7, 'F');
            pdf.setTextColor(255, 255, 255);
            pdf.setFontSize(9);
            pdf.setFont('helvetica', 'bold');
            pdf.text('1. Detalle general', 13, y + 5);
            y += 10;

            const detalle = [
                ['Responsable:', task.userEmail || task.userName || '-'],
                ['Hora Inicio:', task.finalizacionHora ? subtractDuration(task.finalizacionHora, task.tiempoEstadia) : '-'],
                ['Hora Fin:', task.finalizacionHora || '-'],
                ['Duración de Visita:', task.tiempoEstadia || '-'],
                ['Comentario:', task.descripcion || '-'],
            ];

            autoTable(pdf, {
                startY: y,
                margin: { left: 10, right: 10 },
                body: detalle,
                theme: 'plain',
                styles: { fontSize: 9, textColor: TEXTO },
                columnStyles: {
                    0: { fontStyle: 'bold', fillColor: GRIS, cellWidth: 55 },
                    1: { cellWidth: 'auto' }
                },
                tableLineColor: [200, 200, 200],
                tableLineWidth: 0.1,
            });
            y = pdf.lastAutoTable.finalY + 8;

            // ---- SECCIONES POR TIPO ----
            const seccionTitulos = {
                capacitacion: 'CAPACITACIÓN / CHARLA REALIZADA',
                supervision: 'SUPERVISIÓN REALIZADA',
                reunion: 'REUNIÓN / COORDINACIÓN REALIZADA',
                entrega: 'ENTREGA DE ITEMS REALIZADA',
            };

            for (const [tipo, titulo] of Object.entries(seccionTitulos)) {
                const acts = grupos[tipo];

                // Always print the section header
                if (y > 250) { pdf.addPage(); y = 20; }

                pdf.setFontSize(10);
                pdf.setFont('helvetica', 'bold');
                pdf.setTextColor(...TEXTO);
                pdf.text(titulo + ':', 10, y);
                y += 5;

                if (!acts || acts.length === 0) {
                    // Empty table
                    autoTable(pdf, {
                        startY: y,
                        margin: { left: 10, right: 10 },
                        head: [buildHead(tipo)],
                        body: [],
                        theme: 'grid',
                        headStyles: { fillColor: ROJO, textColor: [255, 255, 255], fontSize: 8, fontStyle: 'bold' },
                        styles: { fontSize: 8, textColor: TEXTO },
                    });
                } else {
                    autoTable(pdf, {
                        startY: y,
                        margin: { left: 10, right: 10 },
                        head: [buildHead(tipo)],
                        body: acts.map(a => buildRow(tipo, a)),
                        theme: 'grid',
                        headStyles: { fillColor: ROJO, textColor: [255, 255, 255], fontSize: 8, fontStyle: 'bold' },
                        styles: { fontSize: 8, textColor: TEXTO },
                        alternateRowStyles: { fillColor: [252, 252, 252] },
                    });
                }
                y = pdf.lastAutoTable.finalY + 10;
            }

            // Save
            const fecha = task.finalizacionFecha || 'reporte';
            pdf.save(`Reporte_${task.unidad || 'visita'}_${fecha}.pdf`.replace(/\//g, '-'));

        } catch (err) {
            console.error('PDF Error:', err);
            alert('Error al generar el PDF: ' + err.message);
        } finally {
            if (btn) { btn.innerHTML = `<i class='bx bxs-file-pdf'></i>`; btn.disabled = false; }
        }
    };

    // Helper: Build table header by activity type
    function buildHead(tipo) {
        const base = ['Hora Inicio', 'Hora Fin', 'Tarea'];
        if (tipo === 'capacitacion') return [...base, 'Tema', 'Cant.', 'Comentario', 'Foto'];
        if (tipo === 'supervision') return [...base, 'Detalle'];
        if (tipo === 'reunion') return [...base, 'Detalle', 'Foto'];
        if (tipo === 'entrega') return [...base, 'Detalle', 'Foto'];
        return [...base, 'Detalle'];
    }

    // Helper: Build row by activity type
    function buildRow(tipo, a) {
        const hi = a.hora || '-';
        const hf = a.hora || '-';
        const tarea = a.tipo || '-';
        const foto = a.fotoUrl ? 'SÍ' : 'NO';

        if (tipo === 'capacitacion') {
            return [hi, hf, tarea, a.tema || '-', a.cantidad || '-', a.comentarios || '-', foto];
        }
        if (tipo === 'supervision') {
            // Read 'checklist' array — array of {pregunta, respuesta} objects (keyed 0,1,2...)
            let detalle = '';
            const cl = a.checklist;
            if (cl && typeof cl === 'object') {
                // Could be a real array or a Firestore map with numeric keys
                const items = Array.isArray(cl)
                    ? cl
                    : Object.keys(cl).sort((a, b) => Number(a) - Number(b)).map(k => cl[k]);
                detalle = items
                    .filter(p => p && p.pregunta)
                    .map((p, i) => `${i + 1}. ${p.pregunta}: ${p.respuesta || '-'}`)
                    .join('\n');
            }
            if (!detalle) detalle = a.detalle || a.comentarios || '-';
            return [hi, hf, tarea, detalle];
        }
        if (tipo === 'reunion') {
            return [hi, hf, tarea, a.tema || a.comentarios || '-', foto];
        }
        if (tipo === 'entrega') {
            return [hi, hf, tarea, `${a.tema || ''} ${a.comentarios ? '- ' + a.comentarios : ''}`.trim() || '-', foto];
        }
        return [hi, hf, tarea, a.comentarios || '-'];
    }

    // Helper: Calculate start hour subtracting duration string (e.g. '1h 38m')
    function subtractDuration(horaFin, duracion) {
        if (!horaFin || !duracion) return '-';
        try {
            const [h, m, s] = horaFin.split(':').map(Number);
            const match = duracion.match(/(\d+)h\s*(\d*)m?/);
            if (!match) return horaFin;
            const dh = parseInt(match[1]) || 0;
            const dm = parseInt(match[2]) || 0;
            let totalMin = h * 60 + m - (dh * 60 + dm);
            if (totalMin < 0) totalMin += 24 * 60;
            const rh = Math.floor(totalMin / 60).toString().padStart(2, '0');
            const rm = (totalMin % 60).toString().padStart(2, '0');
            return `${rh}:${rm}:${(s || 0).toString().padStart(2, '0')}`;
        } catch { return horaFin; }
    }

    function updateCharts(counts) {
        const FONT = "'Orbitron', 'Inter', sans-serif";
        const FONT_SM = "'Inter', sans-serif";
        const CYAN = 'rgba(0,212,255,';
        const GRID = 'rgba(0,212,255,0.07)';
        const TICK = '#4a7a9b';

        // Neon palette
        const palette = [
            'rgba(0,212,255,0.82)',
            'rgba(255,23,68,0.78)',
            'rgba(140,30,255,0.78)',
            'rgba(255,180,0,0.78)',
            'rgba(0,255,140,0.78)',
            'rgba(255,80,160,0.78)',
            'rgba(30,180,255,0.78)',
            'rgba(255,120,0,0.78)',
            'rgba(80,255,200,0.78)',
            'rgba(200,0,255,0.78)',
        ];
        const paletteStrong = palette.map(c => c.replace(/, ?[\d.]+\)$/, ',1)'));
        const paletteBorder = paletteStrong;

        const processData = (obj) => {
            const sorted = Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, 10);
            return {
                labels: sorted.map(k => k[0]),
                data: sorted.map(v => v[1]),
            };
        };

        const cData = processData(counts.clients);
        const uData = processData(counts.units);
        const usrData = processData(counts.users);

        const totalUsers = usrData.data.reduce((a, b) => a + b, 0) || 1;

        /* ─── Shared animation ───────────────────────────────── */
        const anim = { duration: 800, easing: 'easeOutQuart' };

        /* ─── 1. Distribución por Cliente (Horizontal Bar) ───── */
        if (charts.client) charts.client.destroy();
        charts.client = new Chart(document.getElementById('chart-clientes'), {
            type: 'bar',
            data: {
                labels: cData.labels,
                datasets: [{
                    label: 'Registros',
                    data: cData.data,
                    backgroundColor: cData.data.map(() => 'rgba(0,212,255,0.18)'),
                    borderColor: cData.data.map(() => 'rgba(0,212,255,0.9)'),
                    borderWidth: 1.5,
                    borderRadius: 6,
                    borderSkipped: false,
                    hoverBackgroundColor: 'rgba(0,212,255,0.35)',
                }]
            },
            options: {
                indexAxis: 'y',
                animation: anim,
                responsive: true,
                maintainAspectRatio: false,
                layout: { padding: { right: 48 } },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(4,16,42,0.92)',
                        borderColor: 'rgba(0,212,255,0.3)',
                        borderWidth: 1,
                        titleColor: '#00d4ff',
                        bodyColor: '#e8f4ff',
                        titleFont: { family: FONT, size: 11 },
                        bodyFont: { family: FONT_SM, size: 12 },
                        callbacks: {
                            label: ctx => `  ${ctx.parsed.x} registros`,
                        }
                    },
                    // Data labels – inline value at end of bar
                    datalabels: {
                        anchor: 'end',
                        align: 'end',
                        color: '#00d4ff',
                        font: { family: FONT, size: 10, weight: '600' },
                        formatter: val => val,
                        padding: { right: 4 },
                    }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        grid: { color: GRID, drawBorder: false },
                        ticks: { color: TICK, font: { family: FONT_SM, size: 10 }, stepSize: 1 },
                        border: { display: false },
                    },
                    y: {
                        grid: { display: false },
                        ticks: {
                            color: '#8ab4cc',
                            font: { family: FONT_SM, size: 10 },
                            callback: function (val) {
                                const lbl = this.getLabelForValue(val);
                                return lbl.length > 28 ? lbl.substring(0, 28) + '…' : lbl;
                            }
                        },
                        border: { display: false },
                    }
                }
            },
        });

        /* ─── 2. Por Unidad (Vertical Bar + gradient) ─────────── */
        if (charts.unit) charts.unit.destroy();
        charts.unit = new Chart(document.getElementById('chart-unidades'), {
            type: 'bar',
            data: {
                labels: uData.labels,
                datasets: [{
                    label: 'Registros',
                    data: uData.data,
                    backgroundColor: palette,
                    borderColor: paletteBorder,
                    borderWidth: 1,
                    borderRadius: 8,
                    borderSkipped: false,
                }]
            },
            options: {
                animation: anim,
                responsive: true,
                maintainAspectRatio: false,
                layout: { padding: { top: 28 } },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(4,16,42,0.92)',
                        borderColor: 'rgba(0,212,255,0.3)',
                        borderWidth: 1,
                        titleColor: '#00d4ff',
                        bodyColor: '#e8f4ff',
                        titleFont: { family: FONT, size: 11 },
                        callbacks: { label: ctx => `  ${ctx.parsed.y} registros` }
                    },
                    datalabels: {
                        anchor: 'end',
                        align: 'top',
                        color: '#e8f4ff',
                        font: { family: FONT, size: 11, weight: '700' },
                        formatter: val => val,
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: {
                            color: '#8ab4cc',
                            font: { family: FONT_SM, size: 9 },
                            maxRotation: 35,
                            callback: function (val) {
                                const lbl = this.getLabelForValue(val);
                                return lbl.length > 14 ? lbl.substring(0, 14) + '…' : lbl;
                            }
                        },
                        border: { display: false },
                    },
                    y: {
                        beginAtZero: true,
                        grid: { color: GRID, drawBorder: false },
                        ticks: { color: TICK, font: { family: FONT_SM, size: 10 }, stepSize: 1 },
                        border: { display: false },
                    }
                }
            },
        });

        /* ─── 3. Top Usuarios (Doughnut + % labels) ───────────── */
        if (charts.user) charts.user.destroy();
        charts.user = new Chart(document.getElementById('chart-usuarios'), {
            type: 'doughnut',
            data: {
                labels: usrData.labels,
                datasets: [{
                    data: usrData.data,
                    backgroundColor: palette,
                    borderColor: 'rgba(4,16,42,0.8)',
                    borderWidth: 2,
                    hoverBorderColor: '#00d4ff',
                    hoverOffset: 10,
                }]
            },
            options: {
                animation: { ...anim, animateRotate: true, animateScale: true },
                responsive: true,
                maintainAspectRatio: false,
                cutout: '58%',
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            color: '#8ab4cc',
                            font: { family: FONT_SM, size: 11 },
                            boxWidth: 12,
                            padding: 14,
                            usePointStyle: true,
                            pointStyleWidth: 8,
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(4,16,42,0.92)',
                        borderColor: 'rgba(0,212,255,0.3)',
                        borderWidth: 1,
                        titleColor: '#00d4ff',
                        bodyColor: '#e8f4ff',
                        titleFont: { family: FONT, size: 11 },
                        callbacks: {
                            label: ctx => {
                                const pct = ((ctx.parsed / totalUsers) * 100).toFixed(1);
                                return `  ${ctx.label}: ${ctx.parsed} (${pct}%)`;
                            }
                        }
                    },
                    datalabels: {
                        color: (ctx) => {
                            // Small slices get a slightly brighter label for readability
                            const pct = (ctx.dataset.data[ctx.dataIndex] / totalUsers) * 100;
                            return pct < 6 ? '#ffffff' : '#fff';
                        },
                        font: (ctx) => {
                            const pct = (ctx.dataset.data[ctx.dataIndex] / totalUsers) * 100;
                            return {
                                family: FONT,
                                size: pct < 6 ? 9 : 10,
                                weight: '700',
                            };
                        },
                        // Always anchor outside for small slices so they don't get hidden
                        anchor: (ctx) => {
                            const pct = (ctx.dataset.data[ctx.dataIndex] / totalUsers) * 100;
                            return pct < 8 ? 'end' : 'center';
                        },
                        align: (ctx) => {
                            const pct = (ctx.dataset.data[ctx.dataIndex] / totalUsers) * 100;
                            return pct < 8 ? 'end' : 'center';
                        },
                        offset: (ctx) => {
                            const pct = (ctx.dataset.data[ctx.dataIndex] / totalUsers) * 100;
                            return pct < 8 ? 8 : 0;
                        },
                        formatter: (val, ctx) => {
                            if (!totalUsers || !val) return '';
                            const pct = ((val / totalUsers) * 100).toFixed(1);
                            return parseFloat(pct) >= 0.1 ? `${pct}%` : '';
                        },
                        textShadowBlur: 6,
                        textShadowColor: 'rgba(0,0,0,0.9)',
                        padding: 2,
                        clamp: true,
                    }

                }
            }
        });
    }
});

/* ═══════════════════════════════════════════════════════════════
   GESTIÓN DE UNIDADES — Cascading editor + Interactive Map (MapLibre GL)
   ═══════════════════════════════════════════════════════════════ */

// ── Cyberpunk / Neon GL Style ─────────────────────────────────────────────
const NEON_MAP_STYLE = {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
        ofm: {
            type: 'vector',
            url: 'https://tiles.openfreemap.org/planet',
        },
    },
    layers: [
        // ── Background ──────────────────────────────────────────────
        {
            id: 'background', type: 'background',
            paint: { 'background-color': '#020c1b' }
        },

        // ── Water ───────────────────────────────────────────────────
        {
            id: 'water-fill', type: 'fill', source: 'ofm', 'source-layer': 'water',
            paint: { 'fill-color': '#050f22' }
        },

        {
            id: 'waterway', type: 'line', source: 'ofm', 'source-layer': 'waterway',
            paint: { 'line-color': '#0a1f38', 'line-width': 1.5 }
        },

        // ── Land ────────────────────────────────────────────────────
        {
            id: 'landcover', type: 'fill', source: 'ofm', 'source-layer': 'landcover',
            paint: { 'fill-color': '#030e1d', 'fill-opacity': 0.9 }
        },

        {
            id: 'landuse', type: 'fill', source: 'ofm', 'source-layer': 'landuse',
            paint: {
                'fill-color': [
                    'match', ['get', 'class'],
                    'residential', '#040f1f',
                    'commercial', '#04101f',
                    'industrial', '#031020',
                    'park', '#02150a',
                    'cemetery', '#031018',
                    'hospital', '#04101d',
                    'school', '#040f1c',
                    '#030d1b',
                ],
            },
        },

        // ── Buildings ───────────────────────────────────────────────
        {
            id: 'building', type: 'fill', source: 'ofm', 'source-layer': 'building',
            minzoom: 14,
            paint: {
                'fill-color': '#091c33',
                'fill-outline-color': '#0e2a4a',
            },
        },

        // ── Roads — GLOW layers (blurred, wide, same color but low opacity) ──
        {
            id: 'road-motorway-glow', type: 'line', source: 'ofm', 'source-layer': 'transportation',
            filter: ['==', ['get', 'class'], 'motorway'],
            paint: {
                'line-color': '#00d4ff',
                'line-width': ['interpolate', ['linear'], ['zoom'], 8, 8, 16, 28],
                'line-blur': ['interpolate', ['linear'], ['zoom'], 8, 6, 16, 18],
                'line-opacity': 0.18,
            },
        },
        {
            id: 'road-trunk-glow', type: 'line', source: 'ofm', 'source-layer': 'transportation',
            filter: ['==', ['get', 'class'], 'trunk'],
            paint: {
                'line-color': '#00d4ff',
                'line-width': ['interpolate', ['linear'], ['zoom'], 8, 6, 16, 20],
                'line-blur': 5,
                'line-opacity': 0.14,
            },
        },
        {
            id: 'road-primary-glow', type: 'line', source: 'ofm', 'source-layer': 'transportation',
            filter: ['==', ['get', 'class'], 'primary'],
            paint: {
                'line-color': '#00ff88',
                'line-width': ['interpolate', ['linear'], ['zoom'], 10, 5, 16, 16],
                'line-blur': 4,
                'line-opacity': 0.16,
            },
        },

        // ── Roads — FILL layers (sharp, visible lines) ───────────────
        {
            id: 'road-path', type: 'line', source: 'ofm', 'source-layer': 'transportation',
            filter: ['in', ['get', 'class'], ['literal', ['path', 'track']]],
            paint: {
                'line-color': '#00333d',
                'line-width': 1,
                'line-dasharray': [3, 3],
            },
        },

        {
            id: 'road-service', type: 'line', source: 'ofm', 'source-layer': 'transportation',
            filter: ['in', ['get', 'class'], ['literal', ['service', 'driveway']]],
            paint: {
                'line-color': '#003040',
                'line-width': ['interpolate', ['linear'], ['zoom'], 13, 1, 17, 3],
            },
        },

        {
            id: 'road-minor', type: 'line', source: 'ofm', 'source-layer': 'transportation',
            filter: ['==', ['get', 'class'], 'minor'],
            paint: {
                'line-color': '#00455a',
                'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.5, 17, 5],
            },
        },

        {
            id: 'road-tertiary', type: 'line', source: 'ofm', 'source-layer': 'transportation',
            filter: ['==', ['get', 'class'], 'tertiary'],
            paint: {
                'line-color': '#005c75',
                'line-width': ['interpolate', ['linear'], ['zoom'], 11, 2, 16, 7],
            },
        },

        {
            id: 'road-secondary', type: 'line', source: 'ofm', 'source-layer': 'transportation',
            filter: ['==', ['get', 'class'], 'secondary'],
            paint: {
                'line-color': '#00ff88',   // neon green for secondary roads
                'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 16, 8],
                'line-opacity': 0.85,
            },
        },

        {
            id: 'road-primary', type: 'line', source: 'ofm', 'source-layer': 'transportation',
            filter: ['==', ['get', 'class'], 'primary'],
            paint: {
                'line-color': '#00ff88',   // neon green primary avenues
                'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 16, 11],
            },
        },

        {
            id: 'road-trunk', type: 'line', source: 'ofm', 'source-layer': 'transportation',
            filter: ['==', ['get', 'class'], 'trunk'],
            paint: {
                'line-color': '#00d4ff',   // neon cyan trunk roads
                'line-width': ['interpolate', ['linear'], ['zoom'], 9, 3, 16, 13],
            },
        },

        {
            id: 'road-motorway', type: 'line', source: 'ofm', 'source-layer': 'transportation',
            filter: ['==', ['get', 'class'], 'motorway'],
            paint: {
                'line-color': '#00d4ff',   // brightest neon cyan highways
                'line-width': ['interpolate', ['linear'], ['zoom'], 8, 4, 16, 16],
            },
        },

        // Rail
        {
            id: 'rail', type: 'line', source: 'ofm', 'source-layer': 'transportation',
            filter: ['in', ['get', 'class'], ['literal', ['rail', 'transit']]],
            paint: {
                'line-color': '#1a3a5c',
                'line-width': 1.5,
                'line-dasharray': [6, 3],
            },
        },

        // ── Boundaries ──────────────────────────────────────────────
        {
            id: 'boundary', type: 'line', source: 'ofm', 'source-layer': 'boundary',
            filter: ['==', ['get', 'admin_level'], 4],
            paint: { 'line-color': '#0d2a40', 'line-width': 1, 'line-dasharray': [4, 2] },
        },

        // ── Road Labels ─────────────────────────────────────────────
        {
            id: 'road-label-minor',
            type: 'symbol',
            source: 'ofm',
            'source-layer': 'transportation_name',
            minzoom: 15,
            filter: ['in', ['get', 'class'], ['literal', ['minor', 'service', 'tertiary']]],
            layout: {
                'text-field': ['get', 'name'],
                'text-font': ['Noto Sans Regular'],
                'text-size': 10,
                'symbol-placement': 'line',
                'text-max-angle': 30,
                'text-pitch-alignment': 'viewport',
            },
            paint: {
                'text-color': '#005f73',
                'text-halo-color': '#020c1b',
                'text-halo-width': 1.5,
            },
        },
        {
            id: 'road-label-secondary',
            type: 'symbol',
            source: 'ofm',
            'source-layer': 'transportation_name',
            minzoom: 13,
            filter: ['in', ['get', 'class'], ['literal', ['secondary', 'primary']]],
            layout: {
                'text-field': ['get', 'name'],
                'text-font': ['Noto Sans Regular'],
                'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10, 17, 14],
                'symbol-placement': 'line',
                'text-max-angle': 30,
                'text-pitch-alignment': 'viewport',
            },
            paint: {
                'text-color': '#00c46a',
                'text-halo-color': '#020c1b',
                'text-halo-width': 2,
            },
        },
        {
            id: 'road-label-motorway',
            type: 'symbol',
            source: 'ofm',
            'source-layer': 'transportation_name',
            minzoom: 11,
            filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk']]],
            layout: {
                'text-field': ['get', 'name'],
                'text-font': ['Noto Sans Bold'],
                'text-size': ['interpolate', ['linear'], ['zoom'], 11, 11, 17, 16],
                'symbol-placement': 'line',
                'text-max-angle': 30,
                'text-pitch-alignment': 'viewport',
            },
            paint: {
                'text-color': '#00d4ff',
                'text-halo-color': '#020c1b',
                'text-halo-width': 2,
            },
        },

        // ── POI Labels (tiendas, servicios, etc.) ────────────────────
        {
            id: 'poi-label',
            type: 'symbol',
            source: 'ofm',
            'source-layer': 'poi',
            minzoom: 15,
            layout: {
                'text-field': ['get', 'name'],
                'text-font': ['Noto Sans Regular'],
                'text-size': 11,
                'text-anchor': 'top',
                'text-offset': [0, 0.4],
                'text-max-width': 8,
            },
            paint: {
                'text-color': '#7de8d8',
                'text-halo-color': '#010914',
                'text-halo-width': 1.5,
            },
        },

        // ── Water Labels ─────────────────────────────────────────────
        {
            id: 'water-label',
            type: 'symbol',
            source: 'ofm',
            'source-layer': 'water_name',
            layout: {
                'text-field': ['get', 'name'],
                'text-font': ['Noto Sans Italic'],
                'text-size': 12,
                'symbol-placement': 'line',
            },
            paint: {
                'text-color': '#1a5c7a',
                'text-halo-color': '#020c1b',
                'text-halo-width': 1,
            },
        },

        // ── Place Labels ─────────────────────────────────────────────
        {
            id: 'place-village',
            type: 'symbol',
            source: 'ofm',
            'source-layer': 'place',
            filter: ['in', ['get', 'class'], ['literal', ['village', 'suburb', 'quarter', 'neighbourhood']]],
            minzoom: 12,
            layout: {
                'text-field': ['get', 'name'],
                'text-font': ['Noto Sans Regular'],
                'text-size': ['interpolate', ['linear'], ['zoom'], 12, 11, 16, 15],
            },
            paint: {
                'text-color': '#4a9aa8',
                'text-halo-color': '#020c1b',
                'text-halo-width': 2,
            },
        },
        {
            id: 'place-city',
            type: 'symbol',
            source: 'ofm',
            'source-layer': 'place',
            filter: ['in', ['get', 'class'], ['literal', ['city', 'town']]],
            layout: {
                'text-field': ['get', 'name'],
                'text-font': ['Noto Sans Bold'],
                'text-size': ['interpolate', ['linear'], ['zoom'], 8, 12, 14, 22],
            },
            paint: {
                'text-color': '#e8f4ff',
                'text-halo-color': '#020c1b',
                'text-halo-width': 2.5,
            },
        },
    ],
};

(function initUnitManager() {
    document.addEventListener('DOMContentLoaded', async () => {

        const selClient = document.getElementById('unit-filter-client');
        const selUnit = document.getElementById('unit-filter-unit');
        const unitGroup = document.getElementById('unit-sel-unit-group');
        const editorCard = document.getElementById('unit-editor');
        const editorName = document.getElementById('unit-editor-name');
        const statusDot = document.querySelector('#unit-selector-status .status-dot');
        const statusText = document.getElementById('unit-status-text');
        const saveBtn = document.getElementById('unit-save-btn');
        const cancelBtn = document.getElementById('unit-cancel-btn');
        const saveMsg = document.getElementById('unit-save-msg');
        const elFecha = document.getElementById('uv-fechacreacion');
        const elTstp = document.getElementById('uv-timestamp');
        const inNombre = document.getElementById('ue-nombre');
        const inGrupo = document.getElementById('ue-grupo');
        const inLat = document.getElementById('ue-lat');
        const inLng = document.getElementById('ue-lng');

        let selectedClientId = null;
        let selectedUnitId = null;
        let originalData = null;
        let glMap = null;
        let glMarker = null;
        let _ignoreSync = false;

        function setStatus(text, active = false) {
            statusText.textContent = text;
            statusDot.classList.toggle('active', active);
        }
        function clearMsg() {
            saveMsg.textContent = '';
            saveMsg.className = 'unit-save-msg';
        }
        function formatTS(ts) {
            if (!ts) return '\u2014';
            if (ts.toDate) return ts.toDate().toLocaleString('es-PE');
            if (ts instanceof Date) return ts.toLocaleString('es-PE');
            return String(ts);
        }

        function buildMarkerEl() {
            const el = document.createElement('div');
            el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="40" viewBox="0 0 30 40">
                <defs>
                    <filter id="pg" x="-60%" y="-60%" width="220%" height="220%">
                        <feGaussianBlur stdDeviation="3" result="blur"/>
                        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
                    </filter>
                </defs>
                <path d="M15 0C7.27 0 1 6.27 1 14c0 9.63 14 26 14 26S29 23.63 29 14C29 6.27 22.73 0 15 0z"
                    fill="#00d4ff" filter="url(#pg)" opacity="0.95"/>
                <circle cx="15" cy="14" r="5.5" fill="#020c1b"/>
                <circle cx="15" cy="14" r="3" fill="#00d4ff" opacity="0.7"/>
            </svg>`;
            el.style.cssText = 'width:30px;height:40px;cursor:grab;filter:drop-shadow(0 0 8px rgba(0,212,255,.95)) drop-shadow(0 0 16px rgba(0,212,255,.4));';
            return el;
        }

        function initMap(lat, lng) {
            if (glMap) {
                _ignoreSync = true;
                if (glMarker) glMarker.setLngLat([lng, lat]);
                glMap.flyTo({ center: [lng, lat], zoom: Math.max(glMap.getZoom(), 15), duration: 800 });
                _ignoreSync = false;
                return;
            }

            glMap = new maplibregl.Map({
                container: 'unit-map',
                style: NEON_MAP_STYLE,
                center: [lng, lat],
                zoom: 15,
                attributionControl: false,
            });

            glMap.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
            glMap.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

            glMap.on('load', () => {
                glMarker = new maplibregl.Marker({ element: buildMarkerEl(), draggable: true, anchor: 'bottom' })
                    .setLngLat([lng, lat])
                    .addTo(glMap);

                glMarker.on('drag', () => {
                    if (_ignoreSync) return;
                    const ll = glMarker.getLngLat();
                    _ignoreSync = true;
                    inLat.value = ll.lat.toFixed(7);
                    inLng.value = ll.lng.toFixed(7);
                    _ignoreSync = false;
                });
                glMarker.on('dragend', () => {
                    const ll = glMarker.getLngLat();
                    inLat.value = ll.lat.toFixed(7);
                    inLng.value = ll.lng.toFixed(7);
                });
            });
        }

        function syncToMap() {
            if (_ignoreSync || !glMarker) return;
            const lat = parseFloat(inLat.value);
            const lng = parseFloat(inLng.value);
            if (!isNaN(lat) && !isNaN(lng)) {
                glMarker.setLngLat([lng, lat]);
                glMap.panTo([lng, lat]);
            }
        }
        inLat.addEventListener('change', syncToMap);
        inLng.addEventListener('change', syncToMap);

        setStatus('Cargando clientes\u2026', false);
        try {
            const snap = await getDocs(collection(db, 'CLIENTES'));
            snap.forEach(d => {
                const opt = document.createElement('option');
                opt.value = d.id;
                opt.textContent = d.data().nombre || d.id;
                selClient.appendChild(opt);
            });
            setStatus('Selecciona un cliente', false);
        } catch (e) {
            setStatus('Error cargando clientes', false);
            console.error(e);
        }

        selClient.addEventListener('change', async () => {
            selectedClientId = selClient.value;
            selectedUnitId = null;
            originalData = null;
            selUnit.innerHTML = '<option value="">-- Seleccionar Unidad --</option>';
            editorCard.style.display = 'none';
            unitGroup.style.opacity = '.4';
            unitGroup.style.pointerEvents = 'none';

            if (!selectedClientId) { setStatus('Selecciona un cliente', false); return; }

            setStatus('Cargando unidades\u2026', false);
            try {
                const snap = await getDocs(collection(db, 'CLIENTES', selectedClientId, 'UNIDADES'));
                if (snap.empty) { setStatus('Sin unidades registradas', false); return; }
                snap.forEach(d => {
                    const opt = document.createElement('option');
                    opt.value = d.id;
                    opt.textContent = d.data().nombre || d.id;
                    selUnit.appendChild(opt);
                });
                unitGroup.style.opacity = '1';
                unitGroup.style.pointerEvents = 'auto';
                setStatus(`${snap.size} unidad(es) disponibles`, true);
            } catch (e) {
                setStatus('Error cargando unidades', false); console.error(e);
            }
        });

        selUnit.addEventListener('change', async () => {
            selectedUnitId = selUnit.value;
            if (!selectedUnitId) { editorCard.style.display = 'none'; return; }

            setStatus('Cargando datos de la unidad\u2026', true);
            editorCard.style.display = 'none';
            showLoader('Cargando unidad...');

            try {
                const snap = await getDocs(collection(db, 'CLIENTES', selectedClientId, 'UNIDADES'));
                const unitDoc = snap.docs.find(d => d.id === selectedUnitId);
                if (!unitDoc) { setStatus('Unidad no encontrada', false); hideLoader(); return; }

                const data = unitDoc.data();
                originalData = { ...data };

                editorName.textContent = data.nombre || selectedUnitId;
                elFecha.textContent = formatTS(data.fechacreacion);
                elTstp.textContent = formatTS(data.timestamp);
                inNombre.value = data.nombre ?? '';
                inGrupo.value = data.grupo ?? '';
                inLat.value = data.latitud ?? '';
                inLng.value = data.longitud ?? '';

                editorCard.style.display = 'block';

                requestAnimationFrame(() => {
                    const lat = parseFloat(data.latitud) || -12.046374;
                    const lng = parseFloat(data.longitud) || -77.042793;
                    initMap(lat, lng);
                    if (glMap) glMap.resize();
                });

                hideLoader(200);
                setStatus(`Editando: ${data.nombre || selectedUnitId}`, true);
                clearMsg();
            } catch (e) {
                hideLoader();
                setStatus('Error cargando campos', false); console.error(e);
            }
        });


        cancelBtn.addEventListener('click', () => {
            if (!originalData) return;
            inNombre.value = originalData.nombre ?? '';
            inGrupo.value = originalData.grupo ?? '';
            inLat.value = originalData.latitud ?? '';
            inLng.value = originalData.longitud ?? '';
            const lat = parseFloat(originalData.latitud) || -12.046374;
            const lng = parseFloat(originalData.longitud) || -77.042793;
            if (glMarker) {
                glMarker.setLngLat([lng, lat]);
                glMap.flyTo({ center: [lng, lat], zoom: 15, duration: 600 });
            }
            saveMsg.textContent = '\u2139 Cambios revertidos.';
            saveMsg.className = 'unit-save-msg';
            saveMsg.style.color = '#4a7a9b';
            setTimeout(clearMsg, 3000);
        });

        saveBtn.addEventListener('click', async () => {
            if (!selectedClientId || !selectedUnitId) return;
            const lat = parseFloat(inLat.value);
            const lng = parseFloat(inLng.value);
            if (isNaN(lat) || isNaN(lng)) {
                saveMsg.textContent = '\u26a0 Latitud y Longitud deben ser n\u00fameros v\u00e1lidos.';
                saveMsg.className = 'unit-save-msg error';
                return;
            }
            saveBtn.disabled = true;
            saveBtn.innerHTML = `<i class='bx bx-loader-alt bx-spin'></i><span>GUARDANDO\u2026</span>`;
            clearMsg();
            try {
                const unitRef = doc(db, 'CLIENTES', selectedClientId, 'UNIDADES', selectedUnitId);
                await updateDoc(unitRef, {
                    nombre: inNombre.value.trim(), grupo: inGrupo.value.trim(),
                    latitud: lat, longitud: lng,
                });
                originalData = { ...originalData, nombre: inNombre.value.trim(), grupo: inGrupo.value.trim(), latitud: lat, longitud: lng };
                editorName.textContent = inNombre.value.trim() || selectedUnitId;
                saveMsg.textContent = '\u2713 Cambios guardados correctamente.';
                saveMsg.className = 'unit-save-msg success';
                setStatus(`Guardado: ${inNombre.value.trim()}`, true);
            } catch (e) {
                saveMsg.textContent = `\u2717 Error al guardar: ${e.message}`;
                saveMsg.className = 'unit-save-msg error';
                console.error(e);
            } finally {
                saveBtn.disabled = false;
                saveBtn.innerHTML = `<i class='bx bx-save'></i><span>GUARDAR CAMBIOS</span>`;
                setTimeout(clearMsg, 4000);
            }
        });
    });
})();

/* 
   GESTIN DE USUARIOS  Firebase Auth  Firestore
    */
(function initUsersManager() {
    document.addEventListener('DOMContentLoaded', async () => {

        // Only init once the view is shown (lazy)
        const navLinks = document.querySelectorAll('.nav-link');
        navLinks.forEach(link => {
            if (link.querySelector('.link-text')?.textContent === 'Usuarios') {
                link.addEventListener('click', () => {
                    if (!_loaded) { _loaded = true; loadUsers(); }
                });
            }
        });

        let _loaded = false;
        let _allUsers = [];       // [{uid, username, email, nombres, tipo, extra, ...}]
        let _editingId = null;     // current Firestore doc id being edited/deleted

        //  DOM 
        const tbody = document.getElementById('uv-tbody');
        const emptyState = document.getElementById('uv-empty');
        const totalCount = document.getElementById('uv-total-count');
        const statusText = document.getElementById('uv-status-text');
        const searchInput = document.getElementById('uv-search');
        const typeFilter = document.getElementById('uv-type-filter');
        const refreshBtn = document.getElementById('uv-refresh-btn');

        // Modals
        const modalEdit = document.getElementById('modal-edit-overlay');
        const modalDelete = document.getElementById('modal-delete-overlay');
        const modalPwd = document.getElementById('modal-pwd-overlay');

        // Edit modal fields
        const meditBadge = document.getElementById('medit-user-badge');
        const meditNombre = document.getElementById('medit-nombres');
        const meditTipo = document.getElementById('medit-tipo');
        const meditEmail = document.getElementById('medit-email');
        const meditExtra = document.getElementById('medit-extra');
        const meditMsg = document.getElementById('medit-msg');
        const meditSave = document.getElementById('medit-save-btn');

        // Delete modal
        const mdelBadge = document.getElementById('mdel-user-badge');
        const mdelMsg = document.getElementById('mdel-msg');
        const mdelConfirm = document.getElementById('mdel-confirm-btn');

        // Password modal
        const mpwdBadge = document.getElementById('mpwd-user-badge');
        const mpwdMsg = document.getElementById('mpwd-msg');
        const mpwdSend = document.getElementById('mpwd-send-btn');

        //  Modal helpers 
        function openModal(overlay) {
            overlay.setAttribute('aria-hidden', 'false');
            overlay.classList.add('open');
            document.body.style.overflow = 'hidden';
        }
        function closeModal(overlay) {
            overlay.setAttribute('aria-hidden', 'true');
            overlay.classList.remove('open');
            document.body.style.overflow = '';
        }
        function clearModalMsg(el) { el.textContent = ''; el.className = 'uv-modal-msg'; }
        function setModalMsg(el, text, type = 'error') {
            el.textContent = text; el.className = 'uv-modal-msg ' + type;
        }

        // Close buttons
        document.querySelectorAll('[data-close]').forEach(btn => {
            btn.addEventListener('click', () => {
                const overlay = document.getElementById(btn.dataset.close);
                if (overlay) closeModal(overlay);
            });
        });
        // Click outside to close
        [modalEdit, modalDelete, modalPwd].forEach(overlay => {
            if (!overlay) return;
            overlay.addEventListener('click', e => {
                if (e.target === overlay) closeModal(overlay);
            });
        });

        //  User badge HTML 
        function badgeHTML(u) {
            const initials = (u.nombres || u.username || '?').slice(0, 2).toUpperCase();
            return `<div class="uv-avatar">${initials}</div>
                    <div>
                        <div class="badge-name">${u.nombres || u.username}</div>
                        <div class="badge-email">${u.email || (u.username + '@...')}</div>
                    </div>`;
        }

        //  Type badge 
        function typeBadge(tipo) {
            const map = {
                admin: 'uv-badge-admin', operador: 'uv-badge-operador',
                supervisor: 'uv-badge-supervisor', cliente: 'uv-badge-cliente',
            };
            const cls = map[(tipo || '').toLowerCase()] || 'uv-badge-default';
            return `<span class="uv-type-badge ${cls}">${tipo || 'N/A'}</span>`;
        }

        //  Status 
        function setStatus(text) { if (statusText) statusText.textContent = text; }

        //  Skeleton rows 
        function showSkeleton(n = 5) {
            tbody.innerHTML = Array.from({ length: n }, () => `
                <tr class="uv-skeleton-row">
                    ${Array.from({ length: 5 }, (_, i) =>
                `<td><div class="uv-skeleton-cell" style="width:${[60, 80, 70, 50, 90][i]}%;height:${i === 0 ? 34 : 18}px"></div></td>`
            ).join('')}
                </tr>`).join('');
        }

        //  Main load 
        async function loadUsers() {
            showLoader('Cargando usuarios...');
            showSkeleton();
            setStatus('Cargando usuarios desde Firestore...');
            if (totalCount) totalCount.textContent = '...';

            try {
                // 1. Load all docs from "usuarios" collection
                const snap = await getDocs(collection(db, 'usuarios'));
                _allUsers = [];

                snap.forEach(d => {
                    const data = d.data();
                    const uid = d.id;   // e.g. "jsolis"

                    // Derive email: use stored email OR reconstruct from username + current user's domain
                    const currentUserEmail = auth.currentUser?.email || '';
                    const domain = currentUserEmail.includes('@') ? currentUserEmail.slice(currentUserEmail.indexOf('@')) : '';
                    const email = data.email || data.correo || (uid && domain ? uid + domain : '');

                    _allUsers.push({
                        username: uid,
                        email: email,
                        nombres: data.nombres || data.nombre || '',
                        tipo: data.tipo || data.rol || '',
                        extra: data.notas || data.extra || '',
                        raw: data,
                    });
                });

                renderTable(_allUsers);
                if (totalCount) totalCount.textContent = _allUsers.length;
                setStatus(`${_allUsers.length} usuario(s) registrado(s)`);
                hideLoader(200);

            } catch (e) {
                hideLoader();
                setStatus('Error cargando usuarios');
                tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#ff1744;padding:24px">
                    Error: ${e.message}</td></tr>`;
                console.error(e);
            }
        }


        //  Render table 
        function renderTable(users) {
            if (!users.length) {
                tbody.innerHTML = '';
                if (emptyState) emptyState.style.display = 'flex';
                return;
            }
            if (emptyState) emptyState.style.display = 'none';

            tbody.innerHTML = users.map(u => {
                const initials = (u.nombres || u.username).slice(0, 2).toUpperCase();
                const emailDisplay = u.email
                    ? `<i class="bx bx-envelope"></i> ${u.email}`
                    : `<span style="color:rgba(255,255,255,.3);font-style:italic">No registrado</span>`;
                return `<tr>
                    <td>
                        <div class="uv-user-cell">
                            <div class="uv-avatar">${initials}</div>
                            <div>
                                <div class="uv-username">${u.username}</div>
                                <div class="uv-uid">${u.nombres || ''}</div>
                            </div>
                        </div>
                    </td>
                    <td class="uv-email-cell">${emailDisplay}</td>
                    <td>${u.nombres || '<span style="color:rgba(255,255,255,.3)"></span>'}</td>
                    <td>${typeBadge(u.tipo)}</td>
                    <td>
                        <div class="uv-actions">
                            <button class="uv-action-btn uv-btn-edit"   data-uid="${u.username}" data-action="edit">
                                <i class="bx bx-edit"></i>Editar
                            </button>
                            <button class="uv-action-btn uv-btn-pwd"    data-uid="${u.username}" data-action="pwd">
                                <i class="bx bx-key"></i>Clave
                            </button>
                            <button class="uv-action-btn uv-btn-del"    data-uid="${u.username}" data-action="del">
                                <i class="bx bx-trash"></i>Eliminar
                            </button>
                        </div>
                    </td>
                </tr>`;
            }).join('');

            // Bind action buttons
            tbody.querySelectorAll('.uv-action-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const uid = btn.dataset.uid;
                    const action = btn.dataset.action;
                    const user = _allUsers.find(u => u.username === uid);
                    if (!user) return;
                    _editingId = uid;
                    if (action === 'edit') openEditModal(user);
                    if (action === 'pwd') openPwdModal(user);
                    if (action === 'del') openDelModal(user);
                });
            });
        }

        //  Search and filter 
        function applyFilters() {
            const q = (searchInput?.value || '').toLowerCase();
            const tipo = (typeFilter?.value || '').toLowerCase();
            const filtered = _allUsers.filter(u => {
                const matchQ = !q ||
                    u.username.toLowerCase().includes(q) ||
                    (u.nombres || '').toLowerCase().includes(q) ||
                    (u.email || '').toLowerCase().includes(q);
                const matchTipo = !tipo || (u.tipo || '').toLowerCase() === tipo;
                return matchQ && matchTipo;
            });
            renderTable(filtered);
            setStatus(`Mostrando ${filtered.length} de ${_allUsers.length} usuario(s)`);
        }

        searchInput?.addEventListener('input', applyFilters);
        typeFilter?.addEventListener('change', applyFilters);
        refreshBtn?.addEventListener('click', () => { _loaded = false; loadUsers(); _loaded = true; });

        //  EDIT MODAL 
        function openEditModal(u) {
            clearModalMsg(meditMsg);
            meditBadge.innerHTML = badgeHTML(u);
            meditNombre.value = u.nombres || '';
            meditTipo.value = u.tipo || 'operador';
            meditEmail.value = u.email || '';
            meditExtra.value = u.extra || '';
            openModal(modalEdit);
        }

        meditSave.addEventListener('click', async () => {
            if (!_editingId) return;
            clearModalMsg(meditMsg);

            const nombres = meditNombre.value.trim();
            if (!nombres) { setModalMsg(meditMsg, 'El nombre es requerido.'); return; }

            meditSave.disabled = true;
            meditSave.innerHTML = `<i class="bx bx-loader-alt bx-spin"></i> Guardando...`;

            try {
                const ref = doc(db, 'usuarios', _editingId);
                const updates = {
                    nombres: nombres,
                    tipo: meditTipo.value,
                };
                if (meditEmail.value.trim()) updates.email = meditEmail.value.trim();
                if (meditExtra.value.trim()) updates.notas = meditExtra.value.trim();
                await updateDoc(ref, updates);

                // Update local cache
                const idx = _allUsers.findIndex(u => u.username === _editingId);
                if (idx !== -1) {
                    _allUsers[idx] = { ..._allUsers[idx], ...updates };
                }
                renderTable(_allUsers);
                if (totalCount) totalCount.textContent = _allUsers.length;

                setModalMsg(meditMsg, 'Cambios guardados correctamente.', 'success');
                setTimeout(() => closeModal(modalEdit), 1600);

            } catch (e) {
                setModalMsg(meditMsg, 'Error: ' + e.message);
                console.error(e);
            } finally {
                meditSave.disabled = false;
                meditSave.innerHTML = `<i class="bx bx-save"></i> Guardar Cambios`;
            }
        });

        //  DELETE MODAL 
        function openDelModal(u) {
            clearModalMsg(mdelMsg);
            mdelBadge.innerHTML = badgeHTML(u);
            openModal(modalDelete);
        }

        mdelConfirm.addEventListener('click', async () => {
            if (!_editingId) return;
            clearModalMsg(mdelMsg);
            mdelConfirm.disabled = true;
            mdelConfirm.innerHTML = `<i class="bx bx-loader-alt bx-spin"></i> Eliminando...`;

            try {
                await deleteDoc(doc(db, 'usuarios', _editingId));
                _allUsers = _allUsers.filter(u => u.username !== _editingId);
                renderTable(_allUsers);
                if (totalCount) totalCount.textContent = _allUsers.length;
                setStatus(`${_allUsers.length} usuario(s) registrado(s)`);
                setModalMsg(mdelMsg, 'Usuario eliminado de Firestore.', 'info');
                setTimeout(() => closeModal(modalDelete), 1500);
            } catch (e) {
                setModalMsg(mdelMsg, 'Error: ' + e.message);
                console.error(e);
            } finally {
                mdelConfirm.disabled = false;
                mdelConfirm.innerHTML = `<i class="bx bx-trash"></i> Si, Eliminar`;
            }
        });

        //  PASSWORD MODAL 
        function openPwdModal(u) {
            clearModalMsg(mpwdMsg);
            mpwdBadge.innerHTML = badgeHTML(u);
            // Reset fields
            const pwdNew = document.getElementById('mpwd-new');
            const pwdConfirm = document.getElementById('mpwd-confirm');
            const bar = document.getElementById('mpwd-strength-bar');
            const hint = document.getElementById('mpwd-match-hint');
            if (pwdNew) pwdNew.value = '';
            if (pwdConfirm) pwdConfirm.value = '';
            if (bar) bar.removeAttribute('data-level');
            if (hint) { hint.textContent = ''; hint.className = 'uv-pwd-match-hint'; }
            openModal(modalPwd);
        }

        // ── Password strength helper ───────────────────────────────
        function pwdStrength(pwd) {
            let score = 0;
            if (pwd.length >= 6) score++;
            if (pwd.length >= 10) score++;
            if (/[A-Z]/.test(pwd) || /[0-9]/.test(pwd)) score++;
            if (/[^A-Za-z0-9]/.test(pwd)) score++;
            return score; // 0..4
        }

        // ── Strength bar live update ───────────────────────────────
        const pwdNewInput = document.getElementById('mpwd-new');
        const pwdConfirmInput = document.getElementById('mpwd-confirm');
        const strengthBar = document.getElementById('mpwd-strength-bar');
        const matchHint = document.getElementById('mpwd-match-hint');

        function updateMatchHint() {
            if (!matchHint || !pwdConfirmInput?.value) {
                if (matchHint) { matchHint.textContent = ''; matchHint.className = 'uv-pwd-match-hint'; }
                return;
            }
            const match = pwdNewInput.value === pwdConfirmInput.value;
            matchHint.textContent = match ? '✓ Las contraseñas coinciden' : '✗ Las contraseñas no coinciden';
            matchHint.className = 'uv-pwd-match-hint ' + (match ? 'ok' : 'error');
        }

        pwdNewInput?.addEventListener('input', () => {
            const score = pwdStrength(pwdNewInput.value);
            if (strengthBar) {
                strengthBar.setAttribute('data-level', pwdNewInput.value ? String(score) : '');
            }
            updateMatchHint();
        });
        pwdConfirmInput?.addEventListener('input', updateMatchHint);

        // ── Toggle show/hide password ──────────────────────────────
        document.querySelectorAll('.uv-pwd-toggle').forEach(btn => {
            btn.addEventListener('click', () => {
                const input = document.getElementById(btn.dataset.target);
                if (!input) return;
                const show = input.type === 'password';
                input.type = show ? 'text' : 'password';
                btn.innerHTML = show ? `<i class="bx bx-hide"></i>` : `<i class="bx bx-show"></i>`;
            });
        });

        // ── Change password via Cloud Function ─────────────────────
        mpwdSend.addEventListener('click', async () => {
            if (!_editingId) return;
            clearModalMsg(mpwdMsg);

            const newPwd = document.getElementById('mpwd-new')?.value || '';
            const confirmPwd = document.getElementById('mpwd-confirm')?.value || '';

            if (!newPwd || newPwd.length < 6) {
                setModalMsg(mpwdMsg, 'La contraseña debe tener al menos 6 caracteres.');
                return;
            }
            if (newPwd !== confirmPwd) {
                setModalMsg(mpwdMsg, 'Las contraseñas no coinciden.');
                return;
            }

            const user = _allUsers.find(u => u.username === _editingId);
            const currentDomain = auth.currentUser?.email?.slice(auth.currentUser.email.indexOf('@')) || '';
            const targetEmail = user?.email || (user?.username && currentDomain ? user.username + currentDomain : '');

            if (!targetEmail) {
                setModalMsg(mpwdMsg, 'No se pudo determinar el correo del usuario.');
                return;
            }

            mpwdSend.disabled = true;
            mpwdSend.innerHTML = `<i class="bx bx-loader-alt bx-spin"></i> Cambiando...`;

            try {
                const functions = getFunctions(undefined, 'us-central1');
                const updateUserPassword = httpsCallable(functions, 'updateUserPassword');
                const result = await updateUserPassword({ targetEmail, newPassword: newPwd });
                setModalMsg(mpwdMsg, result.data?.message || 'Contraseña actualizada correctamente.', 'success');
                setTimeout(() => closeModal(modalPwd), 1800);
            } catch (e) {
                const msg = e?.details || e?.message || 'Error desconocido';
                setModalMsg(mpwdMsg, 'Error: ' + msg);
                console.error(e);
            } finally {
                mpwdSend.disabled = false;
                mpwdSend.innerHTML = `<i class="bx bx-key"></i> Cambiar Contraseña`;
            }
        });

    });
})();

