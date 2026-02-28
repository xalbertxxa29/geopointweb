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
        if (!callerDoc.exists) {
            throw new HttpsError('permission-denied', 'Perfil no encontrado.');
        }

        const callerTipo = (callerDoc.data().tipo || '').toLowerCase();
        const isAdmin = ['admin', 'administrador'].includes(callerTipo);
        const isSuper = callerTipo === 'supervisor';
        const isUser = callerTipo === 'usuario';

        if (!isAdmin && !isSuper && !isUser) {
            throw new HttpsError('permission-denied', 'Tu rol no tiene permisos para cambiar contraseñas.');
        }

        const { targetEmail, newPassword } = request.data;
        if (!targetEmail || !newPassword || newPassword.length < 8) {
            throw new HttpsError('invalid-argument', 'Datos inválidos.');
        }

        // Verify caller has permission over the target user
        if (!isAdmin) {
            // Find target user doc by email
            const usersSnap = await db.collection('usuarios')
                .where('email', '==', targetEmail.toLowerCase()).limit(1).get();

            if (!usersSnap.empty) {
                const targetTipo = (usersSnap.docs[0].data().tipo || '').toLowerCase();

                if (isSuper && ['admin', 'administrador'].includes(targetTipo)) {
                    throw new HttpsError('permission-denied', 'No puedes cambiar la clave de un administrador.');
                }
                if (isUser && !['usuario', 'zonal'].includes(targetTipo)) {
                    throw new HttpsError('permission-denied', 'No tienes permisos para cambiar la clave de este tipo de usuario.');
                }
            }
        }

        try {
            const targetUser = await getAuth().getUserByEmail(targetEmail);
            await getAuth().updateUser(targetUser.uid, { password: newPassword });
            return { success: true, message: 'Contraseña actualizada con éxito.' };
        } catch (err) {
            console.error('[updateUserPassword] Failure for:', targetEmail, err);

            // Return specific error messages for common Auth issues
            if (err.code === 'auth/user-not-found') {
                throw new HttpsError('not-found', 'El usuario no existe en el sistema de autenticación.');
            }
            if (err.code === 'auth/invalid-password') {
                throw new HttpsError('invalid-argument', 'La contraseña no cumple con los requisitos de seguridad.');
            }

            throw new HttpsError('internal', 'Error al actualizar: ' + err.message);
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
        const { username, fullName, email, password, tipo, macrozona, zona } = request.data;
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
                macrozona: (macrozona || '').trim(),
                zona: (zona || '').trim(),
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

            // Si no es admin/supervisor, ver si tiene permiso de usuario/zonal
            const isPowerful = ['admin', 'administrador', 'supervisor'].includes(callerTipo);
            const isBase = ['usuario', 'zonal'].includes(callerTipo);

            if (!isPowerful && !isBase) {
                throw new HttpsError('permission-denied', 'No permitido.');
            }

            const targetDoc = await db.collection('usuarios').doc(targetUid).get();
            if (!targetDoc.exists) throw new HttpsError('not-found', 'Usuario no encontrado.');

            const tTipo = (targetDoc.data().tipo || '').toLowerCase();

            // Reglas de nivel:
            if (callerTipo === 'supervisor') {
                if (['admin', 'administrador', 'supervisor'].includes(tTipo)) {
                    throw new HttpsError('permission-denied', 'Un supervisor no puede eliminar a administradores u otros supervisores.');
                }
            } else if (isBase) {
                if (!['usuario', 'zonal'].includes(tTipo)) {
                    throw new HttpsError('permission-denied', 'No tienes permisos para eliminar este tipo de usuario.');
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
 * deleteUsersBatch
 * Elimina múltiples usuarios de Auth y Firestore.
 */
exports.deleteUsersBatch = onCall(
    { region: 'us-central1', cors: true },
    async (request) => {
        if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado.');

        const callerUsername = (request.auth.token?.email || '').split('@')[0].toLowerCase();
        const { targetUids } = request.data;
        if (!targetUids || !Array.isArray(targetUids) || targetUids.length === 0) {
            throw new HttpsError('invalid-argument', 'Lista de UIDs requerida.');
        }

        const db = getFirestore();
        try {
            const callerDoc = await db.collection('usuarios').doc(callerUsername).get();
            if (!callerDoc.exists) {
                console.error('[deleteUsersBatch] Caller doc not found:', callerUsername);
                throw new HttpsError('permission-denied', `Perfil de usuario no encontrado en Firestore para: ${callerUsername}`);
            }

            const callerTipo = (callerDoc.data()?.tipo || '').toLowerCase();
            console.log('[deleteUsersBatch] Caller:', callerUsername, 'Tipo:', callerTipo);

            const isPowerful = ['admin', 'administrador', 'supervisor'].includes(callerTipo);
            const isBase = ['usuario', 'zonal'].includes(callerTipo);

            if (!isPowerful && !isBase) {
                throw new HttpsError('permission-denied', `Tu rol (${callerTipo}) no tiene permisos para realizar esta operación.`);
            }

            // Verificar permisos para cada usuario del batch
            for (const uid of targetUids) {
                const tDoc = await db.collection('usuarios').doc(uid).get();
                if (tDoc.exists) {
                    const tTipo = (tDoc.data().tipo || '').toLowerCase();

                    if (callerTipo === 'supervisor') {
                        if (['admin', 'administrador', 'supervisor'].includes(tTipo)) {
                            throw new HttpsError('permission-denied', `No puedes eliminar a ${uid} (${tTipo}) porque es de rango igual o superior.`);
                        }
                    } else if (isBase) {
                        if (!['usuario', 'zonal'].includes(tTipo)) {
                            throw new HttpsError('permission-denied', `No tienes permiso para eliminar usuarios de rango ${tTipo}.`);
                        }
                    }
                }
            }

            // Borrar de Auth
            try {
                await getAuth().deleteUsers(targetUids);
            } catch (authErr) {
                console.warn('[deleteUsersBatch] Auth deletion partial/failed:', authErr);
            }

            // Borrar de Firestore (Batched)
            const batch = db.batch();
            targetUids.forEach(uid => {
                batch.delete(db.collection('usuarios').doc(uid));
            });
            await batch.commit();

            return { success: true, count: targetUids.length };
        } catch (err) {
            console.error('[deleteUsersBatch] Error:', err);
            throw new HttpsError('internal', err.message || 'Error al eliminar múltiples usuarios.');
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
        const { targetUid, nombres, tipo, email, notas, macrozona, zona } = request.data;
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

            const upData = {
                nombres: nombres.trim(),
                tipo,
                macrozona: (macrozona || '').trim(),
                zona: (zona || '').trim()
            };
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
