import { BrowserRouter, Routes, Route } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import ActorTracker from "./pages/ActorTracker";
import "./App.css";

function App() {
  return (
    <div className="App dark">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/actor-tracker" element={<ActorTracker />} />
        </Routes>
      </BrowserRouter>
    </div>
  );
}

export default App;