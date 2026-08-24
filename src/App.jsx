import { Routes, Route } from "react-router-dom";
import NetworkPage from "./pages/NetworkPage.jsx";
import AdminPage from "./pages/AdminPage.jsx";
import MobileBlockPage from "./pages/MobileBlockPage.jsx";
import { AuthProvider } from "./hooks/useAuth.jsx";

// Checked once, synchronously, before any route renders -- the network's
// data fetch and rendering never start on mobile, the block page just
// takes over immediately.
const isMobile = () => window.matchMedia("(max-width: 768px)").matches;

export default function App() {
  if (isMobile()) return <MobileBlockPage />;

  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<NetworkPage />} />
        <Route path="/admin" element={<AdminPage />} />
      </Routes>
    </AuthProvider>
  );
}
