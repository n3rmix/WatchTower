import { BrowserRouter, Routes, Route } from "react-router-dom";
import HumanCostPage from "./pages/HumanCostPage";
import ActorNetworkPage from "./pages/ActorNetworkPage";
import LifeTrajectoryPage from "./pages/LifeTrajectoryPage";
import CounterPage from "./pages/CounterPage";
import "./App.css";

function App() {
  return (
    <div className="App dark">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<CounterPage />} />
          <Route path="/human-cost" element={<HumanCostPage />} />
          <Route path="/actor-network" element={<ActorNetworkPage />} />
          <Route path="/life-trajectory" element={<LifeTrajectoryPage />} />
        </Routes>
      </BrowserRouter>
    </div>
  );
}

export default App;
