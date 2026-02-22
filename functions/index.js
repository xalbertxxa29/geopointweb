const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

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

/**
 * createSystemUser
 * Securely creates a new user in Auth and Firestore.
 * Role-based restrictions for 'tipo':
 * - Admin: can create [admin, supervisor, usuario, zonal].
 * - Supervisor: can create [usuario, zonal].
 * - Usuario: can create [usuario, zonal].
 */
exports.createSystemUser = onCall(
    { region: 'us-central1', cors: true },
    async (request) => {
        // 1. Auth check
        if (!request.auth) {
            throw new HttpsError('unauthenticated', 'Debes estar autenticado.');
        }

        const callerEmail = request.auth.token?.email || '';
        const callerUsername = callerEmail.split('@')[0].toLowerCase();
        const { username, fullName, email, password, tipo } = request.data;

        // 2. Input validation
        if (!username || !email || !password || !tipo) {
            throw new HttpsError('invalid-argument', 'Todos los campos son obligatorios.');
        }

        const db = getFirestore();

        try {
            // 3. Check caller permissions
            const callerDoc = await db.collection('usuarios').doc(callerUsername).get();
            if (!callerDoc.exists) throw new HttpsError('permission-denied', 'No tienes un perfil válido.');

            const callerTipo = (callerDoc.data().tipo || '').toLowerCase();
            const targetTipo = tipo.toLowerCase();

            // 4. Enforce role-based logic for creation
            const isCallerAdmin = ['admin', 'administrador'].includes(callerTipo);
            const isCallerSuper = callerTipo === 'supervisor';
            const isCallerUser = callerTipo === 'usuario';

            if (isCallerAdmin) {
                // Admin can do anything
            } else if (isCallerSuper || isCallerUser) {
                // Supervisor/User can only create 'usuario' or 'zonal'
                if (!['usuario', 'zonal'].includes(targetTipo)) {
                    throw new HttpsError('permission-denied', 'No tienes permiso para crear usuarios de este tipo.');
                }
            } else {
                throw new HttpsError('permission-denied', 'Tu rol no permite crear usuarios.');
            }

            // 5. Create in Firebase Auth
            const userRecord = await getAuth().createUser({
                email: email.trim(),
                password: password,
                displayName: fullName,
                uid: username.trim().toLowerCase() // Using username as UID for consistency
            });

            // 6. Create in Firestore
            await db.collection('usuarios').doc(username.trim().toLowerCase()).set({
                nombres: fullName.trim(),
                tipo: tipo,
                email: email.trim().toLowerCase(),
                fechacreacion: FieldValue.serverTimestamp(),
                creadoPor: callerUsername
            });

            return { success: true, uid: userRecord.uid };

        } catch (err) {
            console.error('[createSystemUser] Error:', err);
            if (err.code === 'auth/email-already-exists') {
                throw new HttpsError('already-exists', 'El correo ya está registrado.');
            }
            if (err.code === 'auth/uid-already-exists') {
                throw new HttpsError('already-exists', 'El nombre de usuario ya existe.');
            }
            throw new HttpsError('internal', err.message || 'Error al crear usuario.');
        }
    }
);

/**
 * deleteSystemUser
 * Securely deletes a user from both Firebase Auth and Firestore.
 */
exports.deleteSystemUser = onCall(
    { region: 'us-central1', cors: true },
    async (request) => {
        // 1. Auth check
        if (!request.auth) {
            throw new HttpsError('unauthenticated', 'Debes estar autenticado.');
        }

        const callerEmail = request.auth.token?.email || '';
        const callerUsername = callerEmail.split('@')[0].toLowerCase();
        const { targetUid } = request.data;

        if (!targetUid) {
            throw new HttpsError('invalid-argument', 'UID del usuario a eliminar es requerido.');
        }

        const db = getFirestore();

        try {
            // 2. Check caller permissions
            const callerDoc = await db.collection('usuarios').doc(callerUsername).get();
            if (!callerDoc.exists) throw new HttpsError('permission-denied', 'No tienes un perfil válido.');

            const callerTipo = (callerDoc.data().tipo || '').toLowerCase();
            const isAdmin = ['admin', 'administrador'].includes(callerTipo);

            // Only admins can delete for now, or we can add logic for supervisors
            if (!isAdmin && callerTipo !== 'supervisor') {
                throw new HttpsError('permission-denied', 'No tienes permisos para eliminar usuarios.');
            }

            // 3. fetch target user from firestore to check their role before deletion
            const targetDoc = await db.collection('usuarios').doc(targetUid).get();
            if (targetDoc.exists) {
                const targetTipo = (targetDoc.data().tipo || '').toLowerCase();

                // If caller is supervisor, they can't delete admins or other supervisors
                if (callerTipo === 'supervisor') {
                    if (['admin', 'administrador', 'supervisor'].includes(targetTipo)) {
                        throw new HttpsError('permission-denied', 'Un supervisor solo puede eliminar usuarios de tipo usuario o zonal.');
                    }
                }
            }

            // 4. Delete from Firebase Auth
            try {
                // In this project, UID is often the same as the username (firestore doc ID)
                await getAuth().deleteUser(targetUid);
            } catch (authErr) {
                // If user doesn't exist in Auth, we might still want to delete from Firestore
                console.warn(`[deleteSystemUser] User ${targetUid} not found in Auth, proceeding to delete Firestore doc.`);
            }

            // 5. Delete from Firestore
            await db.collection('usuarios').doc(targetUid).delete();

            return { success: true, message: `Usuario ${targetUid} eliminado correctamente.` };

        } catch (err) {
            console.error('[deleteSystemUser] Error:', err);
            throw new HttpsError('internal', err.message || 'Error al eliminar el usuario.');
        }
    }
);
