import { useContext } from "react";
import { AuthContext } from "./AuthContext.js";

export function useAuth() {
  return useContext(AuthContext).user;
}

export function useAuthSignIn() {
  return useContext(AuthContext).signIn;
}
