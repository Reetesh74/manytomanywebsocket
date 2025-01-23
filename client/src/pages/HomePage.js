import React, { useState } from "react";
import { useNavigate } from "react-router-dom";

const HomePage = () => {
  const [roomId, setRoomId] = useState("");
  const navigate = useNavigate();

  const handleCreateMeeting = async () => {
    try {
      const response = await fetch("http://localhost:3000/createMeeting", {
        method: "POST",
      });
      const data = await response.json();
     
      if (data.roomId) {
        setRoomId(data.roomId);
        alert(
          `Meeting created! Share this link: http://localhost:3001/room/${data.roomId}`
        );
      }
    } catch (error) {
      console.error("Error creating meeting:", error);
    }
  };

  const handleJoinRoom = () => {
    if (roomId.trim() === "") {
      alert("Room ID cannot be empty");
      return;
    }
    navigate(`/room/${roomId}`);
  };

  return (
    <div style={{ padding: "20px" }}>
      <h1>Join or Create a Room</h1>
      <button
        onClick={handleCreateMeeting}
        style={{ padding: "10px", marginRight: "10px" }}
      >
        Create Meeting
      </button>
      <br />
      <input
        type="text"
        value={roomId}
        onChange={(e) => setRoomId(e.target.value)}
        placeholder="Enter Room ID"
        style={{ padding: "10px", marginTop: "10px", marginRight: "10px" }}
      />
      <button onClick={handleJoinRoom} style={{ padding: "10px" }}>
        Join Room
      </button>
    </div>
  );
};

export default HomePage;
