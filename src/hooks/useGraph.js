import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase.js";

// The whole dataset (~1,200 nodes / ~1,400 edges, well under Firestore's
// 1MiB document limit) lives in one doc rather than one-doc-per-node --
// one read per page load for every visitor, instead of ~2,600. Real-time
// (onSnapshot, not a one-time getDoc) so an admin edit shows up for
// everyone already on the page without a refresh.
export function useGraph() {
  const [graph, setGraph] = useState(undefined); // undefined = loading, null = missing

  useEffect(() => {
    const ref = doc(db, "graph", "data");
    const unsub = onSnapshot(ref, (snap) => {
      setGraph(snap.exists() ? snap.data() : null);
    });
    return unsub;
  }, []);

  return graph;
}
