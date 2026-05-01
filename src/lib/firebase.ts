import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

export interface FirestoreErrorInfo {
  error: string;
  operationType: 'create' | 'update' | 'delete' | 'list' | 'get' | 'write';
  path: string | null;
  authInfo: {
    userId: string;
    email: string;
    emailVerified: boolean;
    isAnonymous: boolean;
    providerInfo: { providerId: string; displayName: string; email: string; }[];
  }
}

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

export const handleFirestoreError = (error: unknown, operationType: FirestoreErrorInfo['operationType'], path: string | null = null) => {
  const err = error as { code?: string, message?: string };
  if (err?.code === 'permission-denied') {
    const user = auth.currentUser;
    const errorInfo: FirestoreErrorInfo = {
      error: err.message || 'Missing or insufficient permissions',
      operationType,
      path,
      authInfo: {
        userId: user?.uid || 'anonymous',
        email: user?.email || '',
        emailVerified: user?.emailVerified || false,
        isAnonymous: user?.isAnonymous || true,
        providerInfo: user?.providerData.map(p => ({
          providerId: p.providerId,
          displayName: p.displayName || '',
          email: p.email || ''
        })) || []
      }
    };
    throw new Error(JSON.stringify(errorInfo));
  }
  throw error;
};

// CRITICAL: Test connection on boot
const testConnection = async () => {
  try {
    await getDocFromServer(doc(db, '_internal_', 'connection_test'));
  } catch (error: unknown) {
    const err = error as { message?: string };
    if (err?.message?.includes('the client is offline')) {
      console.error("Please check your Firebase configuration. The client is offline.");
    }
    // Ignore permission denied for this test path as it's just to check connectivity
  }
};
testConnection();

export const provider = new GoogleAuthProvider();

export const signIn = async () => {
  try {
    console.log("Starting signInWithPopup...");
    const result = await signInWithPopup(auth, provider);
    console.log("Sign-in successful for user:", result.user.uid);
  } catch (error) {
    console.error("Error signing in", error);
    // Re-throw or handle so UI can know
    throw error;
  }
};

export const signOut = async () => {
  try {
    await auth.signOut();
  } catch (error) {
    console.error("Error signing out", error);
  }
};
