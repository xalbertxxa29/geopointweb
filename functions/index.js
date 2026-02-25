const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

initializeApp();

/**
 * updateUserPassword
 * Cambia la contraseña de un usuario en Firebase Auth.
 */
exports.updateUserPassword = onCall(
    { region: 'us-central1', cors: true },
    async (request) => {
        if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado.');

        const callerEmail = request.auth.token?.email || '';
        const callerUsername = callerEmail.split('@')[0].toLowerCase();

        const db = getFirestore();
        const callerDoc = await db.collection('usuarios').doc(callerUsername).get();
        if (!callerDoc.exists || !['admin', 'administrador'].includes((callerDoc.data().tipo || '').toLowerCase())) {
            throw new HttpsError('permission-denied', 'Permisos insuficientes.');
        }

        const { targetEmail, newPassword } = request.data;
        if (!targetEmail || !newPassword || newPassword.length < 8) {
            throw new HttpsError('invalid-argument', 'Datos inválidos.');
        }

        try {
            const targetUser = await getAuth().getUserByEmail(targetEmail);
            await getAuth().updateUser(targetUser.uid, { password: newPassword });
            return { success: true };
        } catch (err) {
            console.error('[updateUserPassword] Error:', err);
            throw new HttpsError('internal', 'Error al actualizar contraseña.');
        }
    }
);

/**
 * getUsersList
 * Obtiene la lista de usuarios según el rol del solicitante.
 */
exports.getUsersList = onCall(
    { region: 'us-central1', cors: true },
    async (request) => {
        if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado.');

        const callerEmail = request.auth.token?.email || '';
        const callerUsername = callerEmail.split('@')[0].toLowerCase();
        const db = getFirestore();

        try {
            const callerDoc = await db.collection('usuarios').doc(callerUsername).get();
            if (!callerDoc.exists) return { users: [] };

            const callerTipo = (callerDoc.data().tipo || '').toLowerCase();
            const snapshot = await db.collection('usuarios').get();
            let results = [];

            snapshot.forEach(doc => {
                const u = doc.data();
                const uTipo = (u.tipo || '').toLowerCase();

                if (callerTipo === 'admin' || callerTipo === 'administrador') {
                    results.push({ id: doc.id, ...u });
                } else if (callerTipo === 'supervisor') {
                    if (['usuario', 'supervisor', 'zonal'].includes(uTipo)) {
                        results.push({ id: doc.id, ...u });
                    }
                } else if (callerTipo === 'usuario') {
                    if (['usuario', 'zonal'].includes(uTipo)) {
                        results.push({ id: doc.id, ...u });
                    }
                }
            });

            return { users: results };
        } catch (err) {
            console.error('[getUsersList] Error:', err);
            throw new HttpsError('internal', 'Error al obtener usuarios.');
        }
    }
);

/**
 * createSystemUser
 * Crea un nuevo usuario en Auth y Firestore.
 */
exports.createSystemUser = onCall(
    { region: 'us-central1', cors: true },
    async (request) => {
        if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado.');

        const callerUsername = (request.auth.token?.email || '').split('@')[0].toLowerCase();
        const { username, fullName, email, password, tipo } = request.data;
        if (!username || !email || !password || !tipo) {
            throw new HttpsError('invalid-argument', 'Faltan campos obligatorios.');
        }

        const db = getFirestore();
        try {
            const callerDoc = await db.collection('usuarios').doc(callerUsername).get();
            if (!callerDoc.exists) throw new HttpsError('permission-denied', 'Perfil inválido.');

            const callerTipo = (callerDoc.data().tipo || '').toLowerCase();
            const targetTipo = tipo.toLowerCase();

            // Lógica de permisos
            const isAdmin = ['admin', 'administrador'].includes(callerTipo);
            const isSuper = callerTipo === 'supervisor';
            const isUser = callerTipo === 'usuario';

            if (isAdmin) { /* ok */ }
            else if (isSuper && !['supervisor', 'usuario', 'zonal'].includes(targetTipo)) {
                throw new HttpsError('permission-denied', 'No permitido.');
            }
            else if (isUser && !['usuario', 'zonal'].includes(targetTipo)) {
                throw new HttpsError('permission-denied', 'No permitido.');
            }
            else if (!isAdmin && !isSuper && !isUser) {
                throw new HttpsError('permission-denied', 'No permitido.');
            }

            const uid = username.trim().toLowerCase();
            await getAuth().createUser({ email: email.trim(), password, displayName: fullName, uid });

            await db.collection('usuarios').doc(uid).set({
                nombres: fullName.trim(),
                tipo: tipo,
                email: email.trim().toLowerCase(),
                fechacreacion: FieldValue.serverTimestamp(),
                creadoPor: callerUsername
            });

            return { success: true, uid };
        } catch (err) {
            console.error('[createSystemUser] Error:', err);
            throw new HttpsError('already-exists', err.message);
        }
    }
);

/**
 * deleteSystemUser
 * Elimina un usuario de Auth y Firestore.
 */
exports.deleteSystemUser = onCall(
    { region: 'us-central1', cors: true },
    async (request) => {
        if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado.');

        const callerUsername = (request.auth.token?.email || '').split('@')[0].toLowerCase();
        const { targetUid } = request.data;
        if (!targetUid) throw new HttpsError('invalid-argument', 'UID requerido.');

        const db = getFirestore();
        try {
            const callerDoc = await db.collection('usuarios').doc(callerUsername).get();
            const callerTipo = (callerDoc.data()?.tipo || '').toLowerCase();
            if (callerTipo !== 'admin' && callerTipo !== 'administrador' && callerTipo !== 'supervisor') {
                throw new HttpsError('permission-denied', 'No permitido.');
            }

            const targetDoc = await db.collection('usuarios').doc(targetUid).get();
            if (targetDoc.exists && callerTipo === 'supervisor') {
                const tTipo = (targetDoc.data().tipo || '').toLowerCase();
                if (['admin', 'administrador', 'supervisor'].includes(tTipo)) {
                    throw new HttpsError('permission-denied', 'No permitido.');
                }
            }

            try { await getAuth().deleteUser(targetUid); } catch (e) { console.warn(e); }
            await db.collection('usuarios').doc(targetUid).delete();

            return { success: true };
        } catch (err) {
            console.error('[deleteSystemUser] Error:', err);
            throw new HttpsError('internal', 'Error al eliminar.');
        }
    }
);

/**
 * updateSystemUser
 * Actualiza el perfil de un usuario.
 */
exports.updateSystemUser = onCall(
    { region: 'us-central1', cors: true },
    async (request) => {
        if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado.');

        const callerUsername = (request.auth.token?.email || '').split('@')[0].toLowerCase();
        const { targetUid, nombres, tipo, email, notas } = request.data;
        if (!targetUid || !nombres || !tipo) {
            throw new HttpsError('invalid-argument', 'Datos incompletos.');
        }

        const db = getFirestore();
        try {
            const callerDoc = await db.collection('usuarios').doc(callerUsername).get();
            const callerTipo = (callerDoc.data()?.tipo || '').toLowerCase();
            const isAdmin = ['admin', 'administrador'].includes(callerTipo);
            const isSuper = callerTipo === 'supervisor';
            const isUser = callerTipo === 'usuario';

            const targetDoc = await db.collection('usuarios').doc(targetUid).get();
            if (!targetDoc.exists) throw new HttpsError('not-found', 'No existe.');

            const oldTipo = (targetDoc.data().tipo || '').toLowerCase();
            const newTipo = tipo.toLowerCase();

            if (isAdmin) { /* ok */ }
            else if (isSuper) {
                if (['admin', 'administrador'].includes(oldTipo) || ['admin', 'administrador'].includes(newTipo)) {
                    throw new HttpsError('permission-denied', 'No permitido.');
                }
            }
            else if (isUser) {
                if (!['usuario', 'zonal'].includes(oldTipo) || !['usuario', 'zonal'].includes(newTipo)) {
                    throw new HttpsError('permission-denied', 'No permitido.');
                }
            } else {
                throw new HttpsError('permission-denied', 'No permitido.');
            }

            const upData = { nombres: nombres.trim(), tipo };
            if (email) upData.email = email.trim().toLowerCase();
            if (notas !== undefined) upData.notas = notas.trim();

            await db.collection('usuarios').doc(targetUid).update(upData);
            return { success: true };
        } catch (err) {
            console.error('[updateSystemUser] Error:', err);
            throw new HttpsError('internal', err.message);
        }
    }
);
