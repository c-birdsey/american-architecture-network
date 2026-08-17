// Paste the config object from Firebase Console →
// Project settings → General → Your apps → SDK setup and configuration.
//
// This is NOT a secret. Firebase web config is meant to be public — real
// access control comes from Firestore security rules (see README.md), not
// from hiding these values. This is a fresh, separate Firebase project
// from the private archive's -- do not reuse that project's config here.
export const firebaseConfig = {
  apiKey: "REPLACE_ME",
  authDomain: "REPLACE_ME.firebaseapp.com",
  projectId: "REPLACE_ME",
  storageBucket: "REPLACE_ME.firebasestorage.app",
  messagingSenderId: "REPLACE_ME",
  appId: "REPLACE_ME",
};

// The only people who can sign in and reach /admin. Public visitors never
// hit Google sign-in at all -- this list only gates the admin dashboard.
// Must stay in sync with the Firestore rules in README.md, which are what
// actually enforce it; this constant only controls the app's own
// messaging (a clear rejection instead of a broken screen).
export const ADMIN_EMAILS = ["calder.birdsey@gmail.com"];
