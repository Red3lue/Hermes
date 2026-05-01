import { BrowserRouter, Routes, Route } from "react-router-dom";
import PitchPage from "./pages/Pitch";
import DemosPage from "./pages/Demos";
import QuorumPage from "./pages/Quorum";
import ChatbotPage from "./pages/Chatbot";
import BiomeViewerPage from "./pages/BiomeViewer";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<PitchPage />} />
        <Route path="/demos" element={<DemosPage />} />
        <Route path="/demos/quorum" element={<QuorumPage />} />
        <Route path="/demos/chatbot" element={<ChatbotPage />} />
        <Route path="/biome/:name" element={<BiomeViewerPage />} />
      </Routes>
    </BrowserRouter>
  );
}
