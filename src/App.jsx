import { Routes, Route } from "react-router-dom";
import NetworkPage from "./pages/NetworkPage.jsx";
import AdminPage from "./pages/AdminPage.jsx";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<NetworkPage />} />
      <Route path="/admin" element={<AdminPage />} />
    </Routes>
  );
}
