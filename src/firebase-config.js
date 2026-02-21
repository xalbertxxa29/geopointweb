import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
    apiKey: "AIzaSyA5-v9DhFUgl8tuBFDw50y8x0t0jyS4Qak",
    authDomain: "geopint-dea12.firebaseapp.com",
    projectId: "geopint-dea12",
    storageBucket: "geopint-dea12.firebasestorage.app",
    messagingSenderId: "275082094487",
    appId: "1:275082094487:web:6db788f8d8893e58d586d2"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export { auth, db };
