import { BrowserRouter, Routes, Route } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import HumanCostPage from "./pages/HumanCostPage";
import ActorNetworkPage from "./pages/ActorNetworkPage";
import "./App.css";

function App() {
  return (
    <div className="App dark">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/human-cost" element={<HumanCostPage />} />
          <Route path="/actor-network" element={<ActorNetworkPage />} />
        </Routes>
      </BrowserRouter>
    </div>
  );
}

export default App;
