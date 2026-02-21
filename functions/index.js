const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp();

/**
 * updateUserPassword
 * Called from the admin panel to change another user's Auth password.
 * Security checks:
 *  1. Caller must be authenticated.
 *  2. Caller must have tipo "admin" in Firestore /usuarios/{username}.
 *  3. Password must be >= 8 chars (stronger than client-side 6).
 *  4. Email is validated server-side before use.
 */
exports.updateUserPassword = onCall(
    { region: 'us-central1', cors: true },
    async (request) => {

        // ── 1. Must be authenticated ────────────────────────────────
        if (!request.auth) {
            throw new HttpsError('unauthenticated', 'Debes estar autenticado.');
        }

        const callerEmail = request.auth.token?.email || '';
        const callerUsername = callerEmail.split('@')[0].toLowerCase();

        // ── 2. Caller must be admin in Firestore ────────────────────
        const db = getFirestore();
        const callerDoc = await db.collection('usuarios').doc(callerUsername).get();
        if (!callerDoc.exists) {
            throw new HttpsError('permission-denied', 'Usuario no encontrado en el sistema.');
        }
        const callerTipo = (callerDoc.data().tipo || '').toLowerCase();
        if (callerTipo !== 'admin' && callerTipo !== 'administrador') {
            throw new HttpsError('permission-denied', 'No tienes permisos para cambiar contraseñas.');
        }

        // ── 3. Validate inputs ──────────────────────────────────────
        const { targetEmail, newPassword } = request.data;

        if (!targetEmail || typeof targetEmail !== 'string') {
            throw new HttpsError('invalid-argument', 'Correo requerido.');
        }
        // Simple email format validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(targetEmail.trim())) {
            throw new HttpsError('invalid-argument', 'Formato de correo inválido.');
        }
        if (!newPassword || typeof newPassword !== 'string') {
            throw new HttpsError('invalid-argument', 'Contraseña requerida.');
        }
        if (newPassword.length < 8) {
            throw new HttpsError('invalid-argument', 'La contraseña debe tener al menos 8 caracteres.');
        }

        // ── 4. Prevent admin from changing their own password here ──
        if (targetEmail.trim().toLowerCase() === callerEmail.toLowerCase()) {
            throw new HttpsError('invalid-argument', 'Usa el perfil para cambiar tu propia contraseña.');
        }

        // ── 5. Perform password update ──────────────────────────────
        try {
            const targetUser = await getAuth().getUserByEmail(targetEmail.trim());
            await getAuth().updateUser(targetUser.uid, { password: newPassword });

            // Log the action (no sensitive data in the log)
            console.info(`[updateUserPassword] Admin "${callerUsername}" changed password for uid:${targetUser.uid}`);

            return { success: true, message: `Contraseña actualizada correctamente.` };

        } catch (err) {
            if (err.code === 'auth/user-not-found') {
                throw new HttpsError('not-found', `Usuario no encontrado en Authentication.`);
            }
            // Don't expose internal error details to client
            console.error('[updateUserPassword] Error:', err.code, err.message);
            throw new HttpsError('internal', 'Error al actualizar la contraseña. Intenta de nuevo.');
        }
    }
);

/**
 * getUsersList
 * Securely fetches the list of users based on the caller's role.
 * - admin: sees everyone.
 * - supervisor: sees [supervisor, usuario, zonal]. (Hide admins)
 * - usuario: sees [usuario]. (Hide admins and supervisors)
 */
exports.getUsersList = onCall(
    { region: 'us-central1', cors: true },
    async (request) => {
        // 1. Must be authenticated
        if (!request.auth) {
            throw new HttpsError('unauthenticated', 'Debes estar autenticado.');
        }

        const callerEmail = request.auth.token?.email || '';
        const callerUsername = callerEmail.split('@')[0].toLowerCase();

        const db = getFirestore();

        try {
            // 2. Determine caller's role
            const callerDoc = await db.collection('usuarios').doc(callerUsername).get();
            if (!callerDoc.exists) {
                // If not in "usuarios" collection, they are likely a client or drone, deny list
                return { users: [] };
            }

            const callerTipo = (callerDoc.data().tipo || '').toLowerCase();

            // 3. Define query filters based on role
            // We use standard labels but normalize them
            let query = db.collection('usuarios');
            let results = [];

            const snapshot = await query.get();

            snapshot.forEach(doc => {
                const u = doc.data();
                const uTipo = (u.tipo || u.rol || '').toLowerCase();

                // Visibility Logic:
                // Admin: sees everything
                if (callerTipo === 'admin' || callerTipo === 'administrador') {
                    results.push({ id: doc.id, ...u });
                }
                // Supervisor: sees [usuario, supervisor, zonal] - explicitly excludes admin
                else if (callerTipo === 'supervisor' || callerTipo === 'zonal') {
                    const visibleToSuper = ['usuario', 'supervisor', 'zonal'];
                    if (visibleToSuper.includes(uTipo)) {
                        results.push({ id: doc.id, ...u });
                    }
                }
                // Usuario: sees only [usuario]
                else if (callerTipo === 'usuario') {
                    if (uTipo === 'usuario') {
                        results.push({ id: doc.id, ...u });
                    }
                }
            });

            return { users: results };

        } catch (err) {
            console.error('[getUsersList] Error:', err);
            throw new HttpsError('internal', 'Error al obtener la lista de usuarios.');
        }
    }
);
