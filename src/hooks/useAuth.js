import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../firebase.js";

export function useAuth() {
  const [user, setUser] = useState(undefined); // undefined = still checking, null = signed out

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return unsub;
  }, []);

  return user;
}
