import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import "./styles/index.css";

// Restore the path 404.html stashed before redirecting here, before
// BrowserRouter ever reads the location -- same GitHub Pages SPA-fallback
// pattern as the archive app (see public/404.html).
const redirect = sessionStorage.redirect;
delete sessionStorage.redirect;
if (redirect && redirect !== location.pathname + location.search + location.hash) {
  history.replaceState(null, "", redirect);
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <App />
    </BrowserRouter>
  </StrictMode>
);
