import { BrowserRouter, Routes, Route } from "react-router-dom";
import PitchPage from "./pages/Pitch";
import DemosPage from "./pages/Demos";
import DemoQuorumPage from "./pages/DemoQuorum";
import DemoChatbotPage from "./pages/DemoChatbot";
import DashboardPage from "./pages/Dashboard";
import AgentDetailPage from "./pages/AgentDetail";
import AgentNewPage from "./pages/AgentNew";
import BiomeDetailPage from "./pages/BiomeDetail";
import BiomeListPage from "./pages/BiomeList";
import BiomeNewPage from "./pages/BiomeNew";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<PitchPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/demos" element={<DemosPage />} />
        <Route path="/demos/quorum" element={<DemoQuorumPage />} />
        <Route path="/demos/chatbot" element={<DemoChatbotPage />} />
        <Route path="/agents/new" element={<AgentNewPage />} />
        <Route path="/agents/:ens" element={<AgentDetailPage />} />
        <Route path="/biomes" element={<BiomeListPage />} />
        <Route path="/biomes/new" element={<BiomeNewPage />} />
        <Route path="/biomes/:name" element={<BiomeDetailPage />} />
      </Routes>
    </BrowserRouter>
  );
}
