import React, { useState } from "react";
import io from "socket.io-client";
import "./App.css";
const socket = io.connect("http://localhost:8000");

function App() {
  const [kitList, setKitList] = useState({});
  const [state, setState] = useState("ready");
  const click = (e) => {
    const socketEventName = e.target.innerText.replace(" ", "-");
    socket.emit(socketEventName);
  };
  socket.on("discovered", (data) => {
    setKitList(data);
  });

  socket.on("state", (state) => {
    setState(state);
  });

  return (
    <div className="App">
      <div>
        <button onClick={click}>scan start</button>
        <button onClick={click}>scan stop</button>
      </div>
      <div>
        <button onClick={click}>connect start</button>
        <button onClick={click}>connect stop</button>
      </div>
      <div>
        <button onClick={click}>session start</button>
        <button onClick={click}>session stop</button>
      </div>
      <h1>
        {Object.keys(kitList).length + ` kit is ${state === "startscan" ? "discovered" : state === "startconnect" ? "connected" : "none"}`}
      </h1>
      <ul>
        {Object.keys(kitList).length
          ? Object.keys(kitList).map((curr) => (
              <li key={curr}>
                <div>
                  <h2>{curr}</h2>
                  <h3>{kitList[curr].name}</h3>
                  <p>connect : {kitList[curr].connect ? "connect" : "disconnect"}</p>
                </div>
              </li>
            ))
          : null}
      </ul>
    </div>
  );
}

export default App;
