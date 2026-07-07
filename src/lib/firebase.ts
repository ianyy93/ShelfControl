import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, User } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer, setDoc, serverTimestamp, getDoc } from 'firebase/firestore';
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
        isAnonymous: user?.isAnonymous ?? false,
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
    const user = result.user;
    console.log("Sign-in successful for user:", user.uid);
    // Upsert user profile — preserve createdAt if profile already exists
    const profileRef = doc(db, "users", user.uid);
    await setDoc(profileRef, {
      displayName: user.displayName || "",
      email: user.email || "",
      photoURL: user.photoURL || "",
      createdAt: serverTimestamp(),
    }, { merge: true });
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

export interface UserProfile {
  displayName: string;
  email: string;
  photoURL?: string;
}

export const getUserProfiles = async (uids: string[]): Promise<Record<string, UserProfile>> => {
  if (uids.length === 0) return {};
  try {
    const results = await Promise.all(
      uids.map(async (uid) => {
        try {
          const snap = await getDoc(doc(db, 'users', uid));
          if (snap.exists()) {
            return { uid, profile: snap.data() as UserProfile };
          }
        } catch (err) {
          console.error(`Error getting profile for ${uid}:`, err);
        }
        return { uid, profile: null };
      })
    );
    const result: Record<string, UserProfile> = {};
    results.forEach(({ uid, profile }) => {
      if (profile) {
        result[uid] = profile;
      }
    });
    return result;
  } catch (error) {
    handleFirestoreError(error, 'get', 'users');
    return {};
  }
};

export const syncUserProfile = async (user: User) => {
  try {
    const profileRef = doc(db, "users", user.uid);
    const snap = await getDoc(profileRef);
    if (!snap.exists()) {
      await setDoc(profileRef, {
        displayName: user.displayName || user.email?.split('@')[0] || "User",
        email: user.email || "",
        photoURL: user.photoURL || "",
        createdAt: serverTimestamp(),
      });
      console.log("Created user profile for:", user.uid);
    } else {
      const data = snap.data();
      const needsUpdate = !data.displayName || !data.email || data.photoURL !== (user.photoURL || "");
      if (needsUpdate) {
        await setDoc(profileRef, {
          displayName: user.displayName || data.displayName || user.email?.split('@')[0] || "User",
          email: user.email || data.email || "",
          photoURL: user.photoURL || data.photoURL || "",
          createdAt: data.createdAt || serverTimestamp(),
        }, { merge: true });
        console.log("Updated user profile for:", user.uid);
      }
    }
  } catch (error) {
    console.error("Error syncing user profile:", error);
  }
};
