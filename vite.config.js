import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Custom domain (amerarchnet.calderbirdsey.com for now, see public/CNAME),
// so base is "/" -- if this ever moves to a GitHub Pages subpath instead,
// set this to "/<repo-name>/".
export default defineConfig({
  plugins: [react()],
  base: "/",
});
