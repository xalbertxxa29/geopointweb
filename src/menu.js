import { auth, db } from './firebase-config';
import { onAuthStateChanged, signOut, sendPasswordResetEmail } from "firebase/auth";
import { collection, getDocs, doc, updateDoc, deleteDoc, getDoc, setDoc, serverTimestamp, query, orderBy, limit, addDoc } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { showLoader, hideLoader } from './loader.js';
import { subtractDuration, normalizeUsername } from './utils.js';


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
    const clearBtn = document.getElementById('clear-filters');

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
                document.getElementById('audit-view').style.display = 'none';
            } else if (linkText === 'Usuarios') {
                currentView = 'usuarios';
                dashboardView.style.display = 'none';
                tableSection.style.display = 'none';
                reportsView.style.display = 'none';
                filterSection.style.display = 'none';
                document.getElementById('units-view').style.display = 'none';
                document.getElementById('audit-view').style.display = 'none';
                document.getElementById('usuarios-view').style.display = 'block';
            } else if (linkText === 'Auditoría') {
                currentView = 'audit';
                dashboardView.style.display = 'none';
                tableSection.style.display = 'none';
                reportsView.style.display = 'none';
                filterSection.style.display = 'none';
                document.getElementById('units-view').style.display = 'none';
                document.getElementById('usuarios-view').style.display = 'none';
                document.getElementById('audit-view').style.display = 'block';
            } else {
                currentView = 'other';
                dashboardView.style.display = 'none';
                tableSection.style.display = 'none';
                reportsView.style.display = 'none';
                filterSection.style.display = 'none';
                document.getElementById('units-view').style.display = 'none';
                document.getElementById('usuarios-view').style.display = 'none';
                document.getElementById('audit-view').style.display = 'none';
            }
        });
    });

    /**
     * ── Auditoría System ──
     * Almacena registros de acciones de usuario en Firestore
     */
    async function addAuditLog(action, collectionName, docId, details = {}) {
        try {
            if (!auth.currentUser) return;
            const logCol = collection(db, 'logs');
            await addDoc(logCol, {
                usuario: auth.currentUser.email,
                accion: action.toUpperCase(),
                coleccion: collectionName || 'N/A',
                documento: docId || 'N/A',
                detalles: JSON.stringify(details),
                timestamp: serverTimestamp()
            });
        } catch (e) { console.error("Error logging audit:", e); }
    }
    window.addAuditLog = addAuditLog;

    // --- Authentication & Data Fetching ---
    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            window.location.href = 'index.html';
        } else {
            // Log Login event (only once per session ideally, but here per auth change)
            if (!window._loggedLogin) {
                addAuditLog('LOGIN', 'AUTH', user.uid, { email: user.email });
                window._loggedLogin = true;
            }

            // Set User Display
            displayUsername.textContent = user.displayName || user.email.split('@')[0];

            showLoader('Verificando acceso...');
            try {
                // ── RBAC: Only admin, supervisor and usuario can enter ──────
                const username = user.email.split('@')[0].toLowerCase();
                const userDoc = await getDoc(doc(db, 'usuarios', username));

                if (!userDoc.exists()) {
                    await signOut(auth);
                    window.location.href = 'index.html?error=no-profile';
                    return;
                }

                const role = (userDoc.data().tipo || '').toLowerCase();
                window._currentUserRole = role; // Store globally for other modules
                const allowed = ['admin', 'administrador', 'supervisor', 'usuario'];

                if (!allowed.includes(role)) {
                    await signOut(auth);
                    window.location.href = 'index.html?error=unauthorized-role';
                    return;
                }

                // Hide Audit Nav Link for non-admins
                const isAdminRole = ['admin', 'administrador', 'Administrador'].includes(role);
                if (!isAdminRole) {
                    document.querySelectorAll('.nav-link').forEach(link => {
                        if (link.querySelector('.link-text')?.textContent === 'Auditoría') {
                            link.closest('.nav-item').style.display = 'none';
                        }
                    });
                    // If somehow on audit view, force redirect to dashboard
                    if (currentView === 'audit') {
                        currentView = 'dashboard';
                        dashboardView.style.display = 'grid';
                        tableSection.style.display = 'block';
                        reportsView.style.display = 'none';
                        filterSection.style.display = 'block';
                        document.getElementById('units-view').style.display = 'none';
                        document.getElementById('usuarios-view').style.display = 'none';
                        document.getElementById('audit-view').style.display = 'none';
                    }
                }

                // ── Continue with data load if authorized ──────────────────
                showLoader('Sincronizando datos...');
                const snapshot = await getDocs(collection(db, "tareas"));
                rawData = snapshot.docs.map(doc => {
                    const d = doc.data();
                    return {
                        id: doc.id,
                        ...d,
                        // Normalization
                        userName: normalizeUsername(d.userName || d.userEmail),
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
                if (import.meta.env.DEV) console.error('[menu] Data Load Error:', err);
                hideLoader();
                loadingDiv.innerHTML = `<i class='bx bxs-error-circle'></i> Error al cargar datos. Recarga la página.`;
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

    clearBtn.addEventListener('click', () => {
        showLoader('Limpiando filtros...');

        // Reset all inputs
        dateStart.value = '';
        dateEnd.value = '';
        filterClient.value = '';
        filterUnit.value = '';
        filterUser.value = '';

        // Re-populate units to show all (resetting cascade)
        populateUnits('');

        setTimeout(() => {
            refreshDashboard();
            hideLoader(400);
        }, 100);
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

    // (subtractDuration is now imported from utils.js)


    function updateCharts(counts) {
        const FONT = "'Orbitron', 'Inter', sans-serif";
        const FONT_SM = "'Inter', sans-serif";
        const CYAN = 'rgba(0,212,255,';
        const GRID = 'rgba(0,212,255,0.07)';
        const TICK = '#4a7a9b';

        // Neon palette (HSLA for better control)
        const palette = [
            'hsla(190, 100%, 50%, 0.8)',  // Cyan
            'hsla(345, 100%, 50%, 0.8)',  // Red
            'hsla(270, 100%, 65%, 0.8)',  // Purple
            'hsla(45,  100%, 55%, 0.8)',  // Gold
            'hsla(150, 100%, 50%, 0.8)',  // Green
            'hsla(210, 100%, 60%, 0.8)',  // Blue
            'hsla(15,  100%, 55%, 0.8)',  // Orange
            'hsla(320, 100%, 60%, 0.8)',  // Pink
            'hsla(180, 100%, 40%, 0.8)',  // Teal
            'hsla(280, 100%, 15%, 0.8)',  // Dark Purple
        ];
        const paletteBorder = palette.map(c => c.replace('0.8)', '1)'));

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
                    backgroundColor: cData.data.map((_, i) => palette[i % palette.length].replace('0.8)', '0.15)')),
                    borderColor: cData.data.map((_, i) => palette[i % palette.length]),
                    borderWidth: 2,
                    borderRadius: 4,
                    borderSkipped: false,
                    hoverBackgroundColor: cData.data.map((_, i) => palette[i % palette.length].replace('0.8)', '0.35)')),
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
                    borderColor: '#020b1f',
                    borderWidth: 3,
                    hoverBorderColor: '#00d4ff',
                    hoverOffset: 12,
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
                            return parseFloat(pct) >= 3 ? `${pct}%` : '';
                        },
                        textShadowBlur: 6,
                        textShadowColor: 'rgba(0,0,0,0.9)',
                        padding: 2,
                        clamp: true,
                    }
                }
            },
            plugins: [{
                id: 'centerText',
                beforeDraw: (chart) => {
                    const { width, height, ctx } = chart;
                    ctx.save();
                    ctx.font = `600 1.5rem ${FONT}`;
                    ctx.fillStyle = '#00d4ff';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    const text = totalUsers.toString();
                    ctx.fillText(text, width / 2, height / 2 - 8);

                    ctx.font = `400 0.7rem ${FONT_SM}`;
                    ctx.fillStyle = '#8ab4cc';
                    ctx.fillText('TOTAL', width / 2, height / 2 + 15);
                    ctx.restore();
                }
            }]
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

        //  DOM References (Main Selectors)
        const clientTrigger = document.getElementById('unit-client-trigger');
        const unitTrigger = document.getElementById('unit-unit-trigger');
        const searchModal = document.getElementById('unit-search-modal');
        const searchInput = document.getElementById('unit-search-input');
        const searchResults = document.getElementById('unit-search-results');
        const searchTitle = document.getElementById('search-modal-title');

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

        // New DOM: Add Buttons & Modals
        const btnOpenAddClient = document.getElementById('unit-btn-add-client');
        const btnOpenAddUnit = document.getElementById('unit-btn-add-unit');
        const modalAddClient = document.getElementById('modal-unit-add-client');
        const modalAddUnit = document.getElementById('modal-unit-add-unit');

        // Fields: Add Client
        const mucInClientName = document.getElementById('muc-client-name');
        const mucInUnitName = document.getElementById('muc-unit-name');
        const mucInUnitGroup = document.getElementById('muc-unit-group');
        const mucInLat = document.getElementById('muc-unit-lat');
        const mucInLng = document.getElementById('muc-unit-lng');
        const mucSaveBtn = document.getElementById('muc-save-btn');
        const mucMsg = document.getElementById('muc-msg');

        // Fields: Add Unit
        const muuClientTrigger = document.getElementById('muu-client-trigger');
        const muuInUnitName = document.getElementById('muu-unit-name');
        const muuInUnitGroup = document.getElementById('muu-unit-group');
        const muuInLat = document.getElementById('muu-unit-lat');
        const muuInLng = document.getElementById('muu-unit-lng');
        const muuSaveBtn = document.getElementById('muu-save-btn');
        const muuMsg = document.getElementById('muu-msg');

        let selectedClientId = null;
        let selectedUnitId = null;
        let originalData = null;
        let glMap = null;
        let glMarker = null;

        // Creation Maps
        let mucMap = null, mucMarker = null;
        let muuMap = null, muuMarker = null;

        let _ignoreSync = false;
        let _allClients = [];
        let _allUnits = [];
        let _currentSearchType = 'client';
        let _searchCallback = null; // To reuse search modal for different contexts

        const NEON_MAP_STYLE = 'https://tiles.basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

        // ── Cyber-Neon Styling Engine ──────────────────────────
        function applyNeonStyles(map) {
            const style = map.getStyle();
            if (!style || !style.layers) return;

            style.layers.forEach(layer => {
                // 1. Color Roads, Highways & Tracks
                if (/road|transportation|highway|track|bridge|tunnel/.test(layer.id)) {
                    if (layer.type === 'line') {
                        const isMain = layer.id.includes('motorway') || layer.id.includes('trunk') || layer.id.includes('primary');
                        map.setPaintProperty(layer.id, 'line-color', isMain ? '#00d4ff' : '#00ff88');
                        map.setPaintProperty(layer.id, 'line-opacity', isMain ? 1 : 0.6);

                        // Enhanced Neon Width - Show earlier on zoom out
                        map.setPaintProperty(layer.id, 'line-width', [
                            'interpolate', ['linear'], ['zoom'],
                            10, isMain ? 1 : 0.4,
                            14, isMain ? 3 : 1.5,
                            18, isMain ? 10 : 5
                        ]);
                    }
                }

                // 2. Enhance Labels (Districts, Streets, POIs)
                if (/label|name|place|poi|building|park/.test(layer.id)) {
                    map.setLayoutProperty(layer.id, 'visibility', 'visible');

                    if (layer.type === 'symbol') {
                        // DISTRICTS / CITIES (Priority)
                        const isBigPlace = /city|town|suburb|village|district/.test(layer.id);

                        map.setPaintProperty(layer.id, 'text-color', isBigPlace ? '#00fbff' : '#ffffff');
                        map.setPaintProperty(layer.id, 'text-halo-color', 'rgba(2, 8, 23, 0.95)');
                        map.setPaintProperty(layer.id, 'text-halo-width', isBigPlace ? 2.5 : 1.8);
                        map.setPaintProperty(layer.id, 'text-halo-blur', 0.5);

                        // Font scaling - Districts visible EARLIER and BIGGER
                        map.setLayoutProperty(layer.id, 'text-size', [
                            'interpolate', ['linear'], ['zoom'],
                            7, isBigPlace ? 10 : 0,
                            11, isBigPlace ? 15 : 8,
                            14, isBigPlace ? 18 : 12,
                            17, isBigPlace ? 22 : 15
                        ]);

                        if (isBigPlace) {
                            map.setLayoutProperty(layer.id, 'text-allow-overlap', false);
                            map.setLayoutProperty(layer.id, 'text-ignore-placement', false);
                        }
                    }
                }

                // 3. Highlight Landmarks and POIs
                if (layer.id.includes('poi')) {
                    map.setLayoutProperty(layer.id, 'icon-size', 1);
                    map.setPaintProperty(layer.id, 'icon-opacity', 0.8);
                }
            });

            // Adjust Water/BG for contrast
            if (map.getLayer('background')) map.setPaintProperty('background', 'background-color', '#02060f');
            if (map.getLayer('water')) map.setPaintProperty('water', 'fill-color', '#04162a');
        }

        function setStatus(text, active = false) {
            if (statusText) statusText.textContent = text;
            if (statusDot) statusDot.classList.toggle('active', active);
        }
        function clearMsg(el) { (el || saveMsg).textContent = ''; (el || saveMsg).className = (el ? 'uv-modal-msg' : 'unit-save-msg'); }

        function formatTS(ts) {
            if (!ts) return '\u2014';
            if (ts.toDate) return ts.toDate().toLocaleString('es-PE');
            if (ts instanceof Date) return ts.toLocaleString('es-PE');
            return String(ts);
        }

        // ── Map Universal Builder ────────────────────────────────
        function buildMarkerEl(color = '#00d4ff') {
            const el = document.createElement('div');
            el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="40" viewBox="0 0 30 40">
                <defs><filter id="pg" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="3" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
                <path d="M15 0C7.27 0 1 6.27 1 14c0 9.63 14 26 14 26S29 23.63 29 14C29 6.27 22.73 0 15 0z" fill="${color}" filter="url(#pg)" opacity="0.95"/>
                <circle cx="15" cy="14" r="5.5" fill="#020c1b"/><circle cx="15" cy="14" r="3" fill="${color}" opacity="0.7"/>
            </svg>`;
            el.style.cssText = `width:30px;height:40px;cursor:grab;filter:drop-shadow(0 0 8px ${color});`;
            return el;
        }

        function createMapInstance(containerId, lat, lng, onCoordsUpdate) {
            const map = new maplibregl.Map({
                container: containerId,
                style: NEON_MAP_STYLE,
                center: [lng, lat],
                zoom: 15,
                attributionControl: false,
            });
            map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
            map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

            let marker = null;
            map.on('load', () => {
                applyNeonStyles(map);
                marker = new maplibregl.Marker({ element: buildMarkerEl(), draggable: true, anchor: 'bottom' })
                    .setLngLat([lng, lat])
                    .addTo(map);

                const update = () => {
                    const ll = marker.getLngLat();
                    onCoordsUpdate(ll.lat.toFixed(7), ll.lng.toFixed(7));
                };
                marker.on('drag', update);
                marker.on('dragend', update);
            });
            return { map, getMarker: () => marker };
        }

        // ── Predictive Search Logic (Enhanced) ─────────────────────

        function openSearchModal(type, callback = null) {
            if (!searchModal) return;
            _currentSearchType = type;
            _searchCallback = callback;
            searchTitle.innerHTML = type === 'client'
                ? `<i class='bx bxs-business'></i> Seleccionar Cliente`
                : `<i class='bx bxs-buildings'></i> Seleccionar Unidad`;
            searchInput.value = '';
            searchInput.placeholder = type === 'client' ? "Escribe nombre del cliente..." : "Escribe nombre de la unidad...";
            searchModal.classList.add('open');
            searchModal.setAttribute('aria-hidden', 'false');
            setTimeout(() => searchInput.focus(), 100);
            renderSearchResults('');
        }

        function closeSearchModal() {
            searchModal.classList.remove('open');
            searchModal.setAttribute('aria-hidden', 'true');
            _searchCallback = null;
        }

        function renderSearchResults(query) {
            const data = _currentSearchType === 'client' ? _allClients : _allUnits;
            const q = query.toLowerCase().trim();
            const filtered = data.filter(item =>
                item.nombre.toLowerCase().includes(q) || item.id.toLowerCase().includes(q)
            );

            if (filtered.length === 0) {
                searchResults.innerHTML = `<div class="uv-search-empty">No se encontraron resultados para "${query}"</div>`;
                return;
            }

            searchResults.innerHTML = filtered.map(item => `
                <div class="uv-search-item" data-id="${item.id}">
                    <i class='bx ${_currentSearchType === 'client' ? 'bxs-business' : 'bxs-buildings'}'></i>
                    <span>${item.nombre}</span>
                </div>
            `).join('');

            searchResults.querySelectorAll('.uv-search-item').forEach(el => {
                el.addEventListener('click', () => {
                    if (_searchCallback) {
                        _searchCallback(el.dataset.id, el.querySelector('span').textContent);
                    } else {
                        handleSelection(el.dataset.id, el.querySelector('span').textContent);
                    }
                    closeSearchModal();
                });
            });
        }

        async function handleSelection(id, name) {
            if (_currentSearchType === 'client') {
                if (selectedClientId === id) return;
                selectedClientId = id; selectedUnitId = null;
                clientTrigger.querySelector('.trigger-text').textContent = name;
                unitTrigger.querySelector('.trigger-text').textContent = '-- Seleccionar Unidad --';
                editorCard.style.display = 'none';
                unitGroup.style.opacity = '.4'; unitGroup.style.pointerEvents = 'none';

                setStatus('Cargando unidades\u2026', false);
                try {
                    const snap = await getDocs(collection(db, 'CLIENTES', selectedClientId, 'UNIDADES'));
                    _allUnits = snap.docs.map(d => ({ id: d.id, nombre: d.data().nombre || d.id }));
                    if (_allUnits.length === 0) setStatus('Sin unidades registradas', false);
                    else { unitGroup.style.opacity = '1'; unitGroup.style.pointerEvents = 'auto'; setStatus(`${_allUnits.length} unidad(es) disponibles`, true); }
                } catch (e) { setStatus('Error cargando unidades.', false); }
            } else {
                selectedUnitId = id;
                unitTrigger.querySelector('.trigger-text').textContent = name;
                loadUnitDetail(id);
            }
        }

        async function loadUnitDetail(unitId) {
            setStatus('Cargando datos de la unidad\u2026', true);
            editorCard.style.display = 'none';
            showLoader('Cargando unidad...');
            try {
                const snap = await getDoc(doc(db, 'CLIENTES', selectedClientId, 'UNIDADES', unitId));
                if (!snap.exists()) { setStatus('Unidad no encontrada', false); hideLoader(); return; }
                const data = snap.data(); originalData = { ...data };
                editorName.textContent = data.nombre || unitId;
                elFecha.textContent = formatTS(data.fechacreacion);
                elTstp.textContent = formatTS(data.timestamp);
                inNombre.value = data.nombre ?? ''; inGrupo.value = data.grupo ?? '';
                inLat.value = data.latitud ?? ''; inLng.value = data.longitud ?? '';
                editorCard.style.display = 'block';
                requestAnimationFrame(() => {
                    const lat = parseFloat(data.latitud) || -12.046374, lng = parseFloat(data.longitud) || -77.042793;
                    initMainEditorMap(lat, lng);
                });
                hideLoader(200);
                setStatus(`Editando: ${data.nombre || unitId}`, true);
            } catch (e) { hideLoader(); setStatus('Error cargando datos.', false); }
        }

        function initMainEditorMap(lat, lng) {
            if (glMap) {
                _ignoreSync = true;
                if (glMarker) glMarker.setLngLat([lng, lat]);
                glMap.flyTo({ center: [lng, lat], zoom: Math.max(glMap.getZoom(), 15), duration: 800 });
                _ignoreSync = false;
                return;
            }
            const inst = createMapInstance('unit-map', lat, lng, (la, ln) => {
                if (_ignoreSync) return;
                inLat.value = la; inLng.value = ln;
            });
            glMap = inst.map; glMarker = inst.getMarker();
        }

        // ── Creation Logic ────────────────────────────────────────

        let modalAddUnitClientId = null;

        btnOpenAddClient.addEventListener('click', () => {
            modalAddClient.classList.add('open');
            mucInClientName.value = ''; mucInUnitName.value = ''; mucInUnitGroup.value = '';
            mucInLat.value = '-12.046374'; mucInLng.value = '-77.042793'; clearMsg(mucMsg);
            setTimeout(() => {
                if (!mucMap) {
                    const inst = createMapInstance('muc-map', -12.046374, -77.042793, (la, ln) => {
                        mucInLat.value = la; mucInLng.value = ln;
                    });
                    mucMap = inst.map; mucMarker = inst.getMarker();
                } else {
                    mucMap.resize();
                }
            }, 300);
        });

        btnOpenAddUnit.addEventListener('click', () => {
            modalAddUnit.classList.add('open');
            muuInUnitName.value = ''; muuInUnitGroup.value = '';
            muuInLat.value = '-12.046374'; muuInLng.value = '-77.042793'; clearMsg(muuMsg);
            muuClientTrigger.querySelector('.trigger-text').textContent = '-- Elegir Cliente --';
            modalAddUnitClientId = null;
            setTimeout(() => {
                if (!muuMap) {
                    const inst = createMapInstance('muu-map', -12.046374, -77.042793, (la, ln) => {
                        muuInLat.value = la; muuInLng.value = ln;
                    });
                    muuMap = inst.map; muuMarker = inst.getMarker();
                } else {
                    muuMap.resize();
                }
            }, 300);
        });

        // Map Sync from Inputs (Modals)
        [mucInLat, mucInLng].forEach(el => el.addEventListener('change', () => {
            const lat = parseFloat(mucInLat.value), lng = parseFloat(mucInLng.value);
            if (!isNaN(lat) && !isNaN(lng) && mucMarker) { mucMarker.setLngLat([lng, lat]); mucMap.panTo([lng, lat]); }
        }));
        [muuInLat, muuInLng].forEach(el => el.addEventListener('change', () => {
            const lat = parseFloat(muuInLat.value), lng = parseFloat(muuInLng.value);
            if (!isNaN(lat) && !isNaN(lng) && muuMarker) { muuMarker.setLngLat([lng, lat]); muuMap.panTo([lng, lat]); }
        }));

        muuClientTrigger.addEventListener('click', () => {
            openSearchModal('client', (id, name) => {
                modalAddUnitClientId = id;
                muuClientTrigger.querySelector('.trigger-text').textContent = name;
            });
        });

        // ── SAVE HANDLERS ──────────────────────────────────────────

        mucSaveBtn.addEventListener('click', async () => {
            const clientName = mucInClientName.value.trim();
            const unitName = mucInUnitName.value.trim();
            if (!clientName || !unitName) { mucMsg.textContent = 'Nombre de Cliente y Unidad son obligatorios.'; mucMsg.className = 'uv-modal-msg error'; return; }

            mucSaveBtn.disabled = true; mucSaveBtn.innerHTML = `<i class='bx bx-loader-alt bx-spin'></i> Guardando...`;
            try {
                // 1. Create Client
                await setDoc(doc(db, 'CLIENTES', clientName), { nombre: clientName });
                addAuditLog('CREATE', 'CLIENTES', clientName, { tip: 'Nuevo cliente con unidad inicial' });

                // 2. Create Unit (ID = Name)
                await setDoc(doc(db, 'CLIENTES', clientName, 'UNIDADES', unitName), {
                    nombre: unitName, grupo: mucInUnitGroup.value.trim(),
                    latitud: parseFloat(mucInLat.value), longitud: parseFloat(mucInLng.value),
                    fechacreacion: serverTimestamp(), timestamp: serverTimestamp()
                });
                addAuditLog('CREATE', 'UNIDADES', unitName, { cliente: clientName });
                modalAddClient.classList.remove('open');
                // Refresh local clients
                _allClients.push({ id: clientName, nombre: clientName });
                handleSelection(clientName, clientName); // Auto select
            } catch (e) { mucMsg.textContent = 'Error al guardar.'; mucMsg.className = 'uv-modal-msg error'; }
            finally { mucSaveBtn.disabled = false; mucSaveBtn.innerHTML = `<i class='bx bx-save'></i> Guardar Cliente`; }
        });

        muuSaveBtn.addEventListener('click', async () => {
            const unitName = muuInUnitName.value.trim();
            if (!modalAddUnitClientId || !unitName) { muuMsg.textContent = 'Selecciona un cliente y nombre de unidad.'; muuMsg.className = 'uv-modal-msg error'; return; }

            muuSaveBtn.disabled = true; muuSaveBtn.innerHTML = `<i class='bx bx-loader-alt bx-spin'></i> Guardando...`;
            try {
                await setDoc(doc(db, 'CLIENTES', modalAddUnitClientId, 'UNIDADES', unitName), {
                    nombre: unitName, grupo: muuInUnitGroup.value.trim(),
                    latitud: parseFloat(muuInLat.value), longitud: parseFloat(muuInLng.value),
                    fechacreacion: serverTimestamp(), timestamp: serverTimestamp()
                });
                addAuditLog('CREATE', 'UNIDADES', unitName, { cliente: modalAddUnitClientId });
                modalAddUnit.classList.remove('open');
                // If the selected client is the same, refresh units list
                if (selectedClientId === modalAddUnitClientId) {
                    const snap = await getDocs(collection(db, 'CLIENTES', selectedClientId, 'UNIDADES'));
                    _allUnits = snap.docs.map(d => ({ id: d.id, nombre: d.data().nombre || d.id }));
                    setStatus(`${_allUnits.length} unidad(es) disponibles`, true);
                }
            } catch (e) { muuMsg.textContent = 'Error al guardar.'; muuMsg.className = 'uv-modal-msg error'; }
            finally { muuSaveBtn.disabled = false; muuSaveBtn.innerHTML = `<i class='bx bx-save'></i> Guardar Unidad`; }
        });

        // ── General Listeners ─────────────────────────────────────
        clientTrigger.addEventListener('click', () => openSearchModal('client'));
        unitTrigger.addEventListener('click', () => _allUnits.length > 0 && openSearchModal('unit'));

        document.querySelectorAll('.uv-modal-close, [data-close]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const modalId = btn.getAttribute('data-close') || btn.closest('.uv-modal-overlay').id;
                document.getElementById(modalId).classList.remove('open');
            });
        });

        searchModal.addEventListener('click', (e) => e.target === searchModal && closeSearchModal());
        searchInput.addEventListener('input', (e) => renderSearchResults(e.target.value));

        // Initial Load
        try {
            const snap = await getDocs(collection(db, 'CLIENTES'));
            _allClients = snap.docs.map(d => ({ id: d.id, nombre: d.data().nombre || d.id }));
            setStatus('Selecciona un cliente', false);
        } catch (e) { setStatus('Error cargando inicial.', false); }

        // Sync main editor inputs to map
        [inLat, inLng].forEach(el => el.addEventListener('change', () => {
            if (_ignoreSync || !glMarker) return;
            const la = parseFloat(inLat.value), ln = parseFloat(inLng.value);
            if (!isNaN(la) && !isNaN(ln)) { glMarker.setLngLat([ln, la]); glMap.panTo([ln, la]); }
        }));

        cancelBtn.addEventListener('click', () => {
            if (!originalData) return;
            inNombre.value = originalData.nombre ?? ''; inGrupo.value = originalData.grupo ?? '';
            inLat.value = originalData.latitud ?? ''; inLng.value = originalData.longitud ?? '';
            const lat = parseFloat(originalData.latitud) || -12.046374, lng = parseFloat(originalData.longitud) || -77.042793;
            if (glMarker) { glMarker.setLngLat([lng, lat]); glMap.flyTo({ center: [lng, lat], zoom: 15 }); }
        });

        saveBtn.addEventListener('click', async () => {
            if (!selectedClientId || !selectedUnitId) return;
            const lat = parseFloat(inLat.value), lng = parseFloat(inLng.value);
            if (isNaN(lat) || isNaN(lng)) return;
            saveBtn.disabled = true; saveBtn.innerHTML = `<i class='bx bx-loader-alt bx-spin'></i><span>GUARDANDO...</span>`;
            try {
                const newData = {
                    nombre: inNombre.value.trim(), grupo: inGrupo.value.trim(), latitud: lat, longitud: lng
                };
                await updateDoc(doc(db, 'CLIENTES', selectedClientId, 'UNIDADES', selectedUnitId), newData);
                addAuditLog('UPDATE', 'UNIDADES', selectedUnitId, { cliente: selectedClientId, cambios: newData });

                originalData = { ...originalData, ...newData };
                editorName.textContent = inNombre.value.trim() || selectedUnitId;
                setStatus(`Guardado: ${inNombre.value.trim()}`, true);
            } catch (e) { if (import.meta.env.DEV) console.error(e); }
            finally { saveBtn.disabled = false; saveBtn.innerHTML = `<i class='bx bx-save'></i><span>GUARDAR CAMBIOS</span>`; }
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
        const modalAdd = document.getElementById('modal-add-overlay');

        // Add modal fields
        const maddUsername = document.getElementById('madd-username');
        const maddTipo = document.getElementById('madd-tipo');
        const maddNombres = document.getElementById('madd-nombres');
        const maddEmail = document.getElementById('madd-email');
        const maddPassword = document.getElementById('madd-password');
        const maddSaveBtn = document.getElementById('madd-save-btn');
        const maddMsg = document.getElementById('madd-msg');
        const openAddBtn = document.getElementById('uv-add-user-btn');

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
        const modalSuccess = document.getElementById('modal-success-overlay');
        const msuccEmail = document.getElementById('msucc-email');
        const msuccPassword = document.getElementById('msucc-password');

        // Click outside to close
        [modalEdit, modalDelete, modalPwd, modalAdd, modalSuccess].forEach(overlay => {
            if (!overlay) return;
            overlay.addEventListener('click', e => {
                if (e.target === overlay) closeModal(overlay);
            });
        });

        const copyAllBtn = document.getElementById('msucc-copy-all');
        if (copyAllBtn) {
            copyAllBtn.addEventListener('click', () => {
                const text = `correo: ${msuccEmail.value}\nContraseña: ${msuccPassword.value}`;
                navigator.clipboard.writeText(text).then(() => {
                    const icon = copyAllBtn.querySelector('i');
                    const originalHTML = copyAllBtn.innerHTML;
                    copyAllBtn.innerHTML = `<i class='bx bx-check'></i> ¡Copiado!`;
                    setTimeout(() => copyAllBtn.innerHTML = originalHTML, 2000);
                });
            });
        }

        // ── Addition Logic ──────────────────────────────────────────
        if (maddUsername) {
            maddUsername.addEventListener('input', () => {
                const val = maddUsername.value.trim().toLowerCase();
                maddEmail.value = val ? `${val}@liderman.com.pe` : '';
            });
        }

        if (openAddBtn) {
            openAddBtn.addEventListener('click', () => {
                clearModalMsg(maddMsg);
                maddUsername.value = '';
                maddNombres.value = '';
                maddEmail.value = '';
                maddPassword.value = '';

                // Populate dropdown based on role
                const myRole = (window._currentUserRole || '').toLowerCase();
                let options = [];
                if (['admin', 'administrador'].includes(myRole)) {
                    options = ['admin', 'supervisor', 'usuario', 'zonal'];
                } else if (myRole === 'supervisor') {
                    options = ['usuario', 'zonal'];
                } else {
                    options = ['usuario', 'zonal'];
                }

                maddTipo.innerHTML = options.map(opt =>
                    `<option value="${opt}">${opt.toUpperCase()}</option>`
                ).join('');

                openModal(modalAdd);
            });
        }

        if (maddSaveBtn) {
            maddSaveBtn.addEventListener('click', async () => {
                const username = maddUsername.value.trim();
                const fullName = maddNombres.value.trim();
                const email = maddEmail.value.trim();
                const password = maddPassword.value;
                const tipo = maddTipo.value;

                if (!username || !fullName || !email || !password || !tipo) {
                    setModalMsg(maddMsg, 'Todos los campos son obligatorios.');
                    return;
                }
                if (password.length < 8) {
                    setModalMsg(maddMsg, 'La contraseña debe tener al menos 8 caracteres.');
                    return;
                }

                maddSaveBtn.disabled = true;
                maddSaveBtn.textContent = 'CREANDO...';
                clearModalMsg(maddMsg);

                try {
                    const functions = getFunctions(auth.app, 'us-central1');
                    const createCall = httpsCallable(functions, 'createSystemUser');

                    await createCall({ username, fullName, email, password, tipo });
                    addAuditLog('CREATE', 'USUARIOS', username, { email, tipo, fullName });

                    // Show credentials in success modal
                    msuccEmail.value = email;
                    msuccPassword.value = password;

                    closeModal(modalAdd);
                    setTimeout(() => {
                        openModal(modalSuccess);
                        loadUsers(); // Refresh table
                    }, 300);
                } catch (e) {
                    if (import.meta.env.DEV) console.error('[menu] create error:', e);
                    setModalMsg(maddMsg, e.message || 'Error al crear usuario.');
                } finally {
                    maddSaveBtn.disabled = false;
                    maddSaveBtn.innerHTML = `<i class='bx bx-user-plus'></i> Crear Usuario`;
                }
            });
        }

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
            setStatus('Consultando permisos...');
            if (totalCount) totalCount.textContent = '...';

            try {
                // Securely fetch filtered list via Cloud Function
                const functions = getFunctions(auth.app, 'us-central1');
                const getUsers = httpsCallable(functions, 'getUsersList');

                const result = await getUsers();
                const usersData = result.data.users || [];

                _allUsers = [];

                usersData.forEach(u => {
                    const data = u; // Function already sends formatted data
                    const uid = u.id;

                    // Derive email
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

                if (_allUsers.length === 0) {
                    setStatus('No tienes permisos para ver usuarios o la lista está vacía.');
                } else {
                    setStatus(`${_allUsers.length} usuario(s) visible(s)`);
                }
                hideLoader(200);

            } catch (e) {
                if (import.meta.env.DEV) console.error('[menu] getUsersList error:', e);
                hideLoader();
                setStatus('Error de seguridad al cargar usuarios.');
                tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#ff1744;padding:24px">
                    <i class='bx bx-lock-alt' style="font-size:2rem"></i><br>
                    Acceso restringido o error de conexión.
                </td></tr>`;
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
                    <td>${u.nombres || '<span style="color:rgba(255,255,255,.3)">-</span>'}</td>
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
                addAuditLog('UPDATE', 'USUARIOS', _editingId, { cambios: updates });

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
                const functions = getFunctions(auth.app, 'us-central1');
                const deleteCall = httpsCallable(functions, 'deleteSystemUser');

                await deleteCall({ targetUid: _editingId });
                addAuditLog('DELETE', 'USUARIOS', _editingId, { motivo: 'Eliminación manual' });

                _allUsers = _allUsers.filter(u => u.username !== _editingId);
                renderTable(_allUsers);
                if (totalCount) totalCount.textContent = _allUsers.length;
                setStatus(`${_allUsers.length} usuario(s) registrado(s)`);
                setModalMsg(mdelMsg, 'Usuario eliminado por completo.', 'info');
                setTimeout(() => closeModal(modalDelete), 1500);
            } catch (e) {
                setModalMsg(mdelMsg, 'Error: ' + (e.details || e.message));
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
                addAuditLog('UPDATE-PWD', 'USUARIOS', targetEmail, { method: 'Clave manual' });
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


/* 
   AUDITORÍA DE SISTEMA
*/
(function initAuditManager() {
    document.addEventListener('DOMContentLoaded', async () => {
        // Navigation listener to lazy load
        const navLinks = document.querySelectorAll('.nav-link');
        navLinks.forEach(link => {
            if (link.querySelector('.link-text')?.textContent === 'Auditoría') {
                link.addEventListener('click', () => {
                    if (!_loaded) { _loaded = true; loadLogs(); }
                });
            }
        });

        let _loaded = false;
        let _allLogs = [];

        // DOM Elements
        const tbody = document.getElementById('av-tbody');
        const emptyState = document.getElementById('av-empty');
        const statusText = document.getElementById('av-status-text');
        const applyBtn = document.getElementById('av-apply-filters');
        const clearBtn = document.getElementById('av-clear-filters');
        const refreshBtn = document.getElementById('av-refresh-btn');
        const dateStart = document.getElementById('av-date-start');
        const dateEnd = document.getElementById('av-date-end');
        const userFilter = document.getElementById('av-user-filter');

        function setStatus(text, active = false) {
            if (statusText) statusText.textContent = text;
            const dot = document.querySelector('#audit-view .uv-status-dot');
            if (dot) dot.classList.toggle('active', active);
        }

        async function loadLogs() {
            setStatus('Cargando registros...', true);
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px"><i class="bx bx-loader-alt bx-spin" style="font-size:2rem"></i></td></tr>';

            try {
                const logsRef = collection(db, 'logs');
                const q = query(logsRef, orderBy('timestamp', 'desc'), limit(250));
                const snap = await getDocs(q);
                _allLogs = snap.docs.map(d => ({ id: d.id, ...d.data() }));

                renderTable(_allLogs);
            } catch (e) {
                console.error(e);
                setStatus('Error al cargar logs.', false);
            }
        }

        function renderTable(logs) {
            if (!logs.length) {
                tbody.innerHTML = '';
                emptyState.style.display = 'flex';
                setStatus('No hay registros.', false);
                return;
            }
            emptyState.style.display = 'none';

            tbody.innerHTML = logs.map(l => {
                const ts = l.timestamp?.toDate ? l.timestamp.toDate().toLocaleString('es-PE') : '---';
                return `<tr>
                    <td style="color:#00e5ff; font-family:monospace; font-size:0.85rem">${ts}</td>
                    <td><div style="display:flex; align-items:center; gap:0.5rem"><i class='bx bx-user-circle' style="color:#00d4ff"></i> ${l.usuario}</div></td>
                    <td><span class="uv-type-badge ${getActionClass(l.accion)}">${l.accion}</span></td>
                    <td><code style="background:rgba(255,255,255,0.05); padding:2px 4px; border-radius:4px">${l.coleccion}</code></td>
                    <td style="max-width:150px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap" title="${l.documento}">${l.documento}</td>
                    <td style="font-size:0.75rem; color:rgba(255,255,255,0.5)">${l.detalles}</td>
                </tr>`;
            }).join('');
            setStatus(`${logs.length} registros cargados.`, true);
        }

        function getActionClass(acc) {
            const a = acc.toLowerCase();
            if (a.includes('create') || a.includes('add')) return 'uv-badge-admin';
            if (a.includes('update') || a.includes('edit')) return 'uv-badge-supervisor';
            if (a.includes('delete') || a.includes('remove')) return 'uv-badge-operador';
            if (a.includes('login')) return 'uv-badge-cliente';
            return 'uv-badge-default';
        }

        function applyFilters() {
            const u = userFilter.value.trim().toLowerCase();
            const ds = dateStart.value;
            const de = dateEnd.value;

            const filtered = _allLogs.filter(l => {
                const matchU = !u || l.usuario.toLowerCase().includes(u);
                const ts = l.timestamp?.toDate ? l.timestamp.toDate() : null;
                let matchD = true;
                if (ts) {
                    if (ds) { const start = new Date(ds); start.setHours(0, 0, 0, 0); if (ts < start) matchD = false; }
                    if (de) { const end = new Date(de); end.setHours(23, 59, 59, 999); if (ts > end) matchD = false; }
                }
                return matchU && matchD;
            });
            renderTable(filtered);
        }

        applyBtn.addEventListener('click', applyFilters);
        clearBtn.addEventListener('click', () => {
            dateStart.value = '';
            dateEnd.value = '';
            userFilter.value = '';
            applyFilters();
        });
        refreshBtn.addEventListener('click', loadLogs);
    });
})();
