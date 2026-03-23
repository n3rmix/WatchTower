import { BrowserRouter, Routes, Route } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import HumanCostPage from "./pages/HumanCostPage";
import "./App.css";

function App() {
  return (
    <div className="App dark">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/human-cost" element={<HumanCostPage />} />
        </Routes>
      </BrowserRouter>
    </div>
  );
}

export default App;
