import React from "react";
import { BrowserRouter as Router, Routes, Route, useParams } from "react-router-dom";
import HomePage from "./pages/HomePage";
import ConferencePage from "./components/ConferencePage"; // Import ConferencePage component

const App = () => {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/room/:roomId" element={<Room />} /> {/* Use the locally declared Room */}
      </Routes>
    </Router>
  );
};

// Use the locally declared Room component
const Room = () => {
  const { roomId } = useParams(); // Access the room ID from the URL
  return <ConferencePage roomId={roomId} />;
};

export default App;
