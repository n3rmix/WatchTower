import { BrowserRouter, Routes, Route } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import SurgeDetector from "./pages/SurgeDetector";
import "./App.css";

function App() {
  return (
    <div className="App dark">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/surge-detector" element={<SurgeDetector />} />
        </Routes>
      </BrowserRouter>
    </div>
  );
}

export default App;
