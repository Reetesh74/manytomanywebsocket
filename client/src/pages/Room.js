import React from "react";
import { useParams } from "react-router-dom";
import ConferencePage from "../components/ConferencePage";

const Room = () => {
  const { roomId } = useParams();
  return <ConferencePage roomId={roomId} />;
};

export default Room;
