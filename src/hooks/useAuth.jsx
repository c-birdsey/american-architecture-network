import { useEffect, useState } from "react";
import { onAuthStateChanged, signInWithPopup } from "firebase/auth";
import { auth, googleProvider } from "../firebase.js";
import { AuthContext } from "./AuthContext.js";

// Mounted once at the app root so sign-in state survives the admin
// overlay closing and reopening (a React unmount/remount, not a page
// reload). signInWithPopup resolves with the signed-in user, but the
// popup's postMessage back to this tab is unreliable in some Chrome
// profiles (third-party storage restrictions), so onAuthStateChanged can
// fail to fire afterward -- signIn() sets state directly from the
// resolved credential instead of waiting on that listener.
export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = still checking, null = signed out

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return unsub;
  }, []);

  async function signIn() {
    const result = await signInWithPopup(auth, googleProvider);
    setUser(result.user);
    return result.user;
  }

  return <AuthContext.Provider value={{ user, signIn }}>{children}</AuthContext.Provider>;
}
