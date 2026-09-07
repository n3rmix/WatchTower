import { BrowserRouter, Routes, Route } from "react-router-dom";
import CounterPage from "./pages/CounterPage";
import "./App.css";

function App() {
  return (
    <div className="App dark">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<CounterPage />} />
        </Routes>
      </BrowserRouter>
    </div>
  );
}

export default App;
