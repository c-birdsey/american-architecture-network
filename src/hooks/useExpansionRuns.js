import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "../firebase.js";

// Real-time (onSnapshot, not a one-time getDoc) for the same reason as
// useGraph -- a run kicked off from one admin's browser finishes minutes
// or hours later in the Cloud Function (see functions/index.js), and any
// admin looking at the Database Expansion tab should see it move from
// "running" to "awaiting_review" without a refresh.
export function useExpansionRuns() {
  const [runs, setRuns] = useState(undefined); // undefined = loading
  const [error, setError] = useState(null);

  useEffect(() => {
    const q = query(collection(db, "expansionRuns"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setError(null);
        setRuns(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      // Without this, a permission-denied query (e.g. firestore.rules not
      // deployed yet) fails silently and `runs` just sits at undefined
      // forever -- the tab reads as "stuck loading" with no clue why.
      (err) => setError(err)
    );
    return unsub;
  }, []);

  return { runs, error };
}
