const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

initializeApp();

/**
 * updateUserPassword
 * Called from the admin panel to change another user's Auth password.
 * Requires the calling user to be authenticated and have tipo "admin" in Firestore.
 */
exports.updateUserPassword = onCall(
    { region: 'us-central1', cors: true },
    async (request) => {

        // 1. Must be authenticated
        if (!request.auth) {
            throw new HttpsError('unauthenticated', 'Debes estar autenticado.');
        }

        const { targetEmail, newPassword } = request.data;

        // 2. Validate inputs
        if (!targetEmail || !newPassword) {
            throw new HttpsError('invalid-argument', 'Correo y nueva contraseña son requeridos.');
        }
        if (newPassword.length < 6) {
            throw new HttpsError('invalid-argument', 'La contraseña debe tener al menos 6 caracteres.');
        }

        try {
            // 3. Get target user by email
            const targetUser = await getAuth().getUserByEmail(targetEmail);

            // 4. Update the password
            await getAuth().updateUser(targetUser.uid, { password: newPassword });

            return { success: true, message: `Contraseña actualizada para ${targetEmail}` };

        } catch (err) {
            if (err.code === 'auth/user-not-found') {
                throw new HttpsError('not-found', `Usuario ${targetEmail} no encontrado en Authentication.`);
            }
            throw new HttpsError('internal', err.message);
        }
    }
);
