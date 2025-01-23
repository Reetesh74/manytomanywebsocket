import { Transport } from "mediasoup-client/lib/types";
import React, { useEffect, useRef, useState } from "react";
import io from "socket.io-client";
const mediaSoupClient = require("mediasoup-client");
const SERVER_URL = "http://localhost:3000"; // Make sure this matches the server's URL
const socket = io(SERVER_URL);
let device;

const roomName = window.location.pathname.split("/")[2];

const ConferencePage = ({ roomId }) => {
  const [isStreaming, setIsStreaming] = useState(false);
  const videoContainerRef = useRef(null);
  const videoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  let isProducer = false;
  let producerTransport;
  let consumerTransports = [];
  let producer;
  let consumer;
  let rtpCapabilities;
  let params = {
    // mediasoup params
    encodings: [
      {
        rid: "r0",
        maxBitrate: 100000,
        scalabilityMode: "S1T3",
      },
      {
        rid: "r1",
        maxBitrate: 300000,
        scalabilityMode: "S1T3",
      },
      {
        rid: "r2",
        maxBitrate: 900000,
        scalabilityMode: "S1T3",
      },
    ],
    // https://mediasoup.org/documentation/v3/mediasoup-client/api/#ProducerCodecOptions
    codecOptions: {
      videoGoogleStartBitrate: 1000,
    },
  };

  let audioParams;
  let videoParams = { params };
  let consumingTransports = [];
  
  useEffect(() => {
    // Listen for connection success
    socket.on("connection-success", ({ socketId }) => {
      console.log("Connected to server with socket ID:", socketId);
      startVideoStream();
    });

    // Clean up listener on unmount
    return () => {
      socket.off("connection-success");
    };
  }, []);

  const createDevice = async () => {
    // debugger;
    try {
      device = new mediaSoupClient.Device();
      await device.load({
        routerRtpCapabilities: rtpCapabilities,
      });
      // setRtpCapabilities(rtpCapabilities);
      createSendTransport();
      console.log("rtp rtpCapabilities", rtpCapabilities);
    } catch (error) {
      console.log(error);
    }
  };

  const startVideoStream = async () => {
    if (isStreaming) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      // Assign the stream to the video element
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }

      setIsStreaming(true);
      joinRoom(true);
    } catch (error) {
      console.error("Error accessing user media:", error);
      alert("Unable to access webcam or microphone.");
    }
  };

  const joinRoom = () => {
    // debugger
    socket.emit("joinRoom", { roomName }, (data) => {
      console.log(`router RTP rtpCapabilities...${data.rtpCapabilities}`);
      rtpCapabilities = data.rtpCapabilities;
      createDevice();
    });
  };
  // const goConsume = () => {
  //   debugger;
  //   goConnect(false);
  // };

  // const goConnect = (producerOrConsumer) => {
  //   isProducer = producerOrConsumer;
  //   device === undefined ? getRtpCapabilities() : goCreateTransport();
  // };

  // const goCreateTransport = () => {
  //   // debugger;
  //   // isProducer ? createSendTransport() : createRecvTransport();
  // };

  const getRtpCapabilities = () => {
    socket.emit("createRoom", (data) => {
      //   const { rtpCapabilities } = data;
      console.log("Received RTP Capabilities from server:", data);

      if (!data.rtpCapabilities || !data.rtpCapabilities.codecs) {
        console.error("Invalid RTP Capabilities received from server.");
        return;
      }

      //   rtpCapabilities = data.rtpCapabilities;
      createDevice(data.rtpCapabilities);
    });
  };

  socket.on("new-producer", ({ producerId }) =>
    signalNewConsumerTransport(producerId)
  );

  const getProducers = () => {
    socket.emit("getProducers", (producerIds) => {
      producerIds.forEach(signalNewConsumerTransport);
    });
  };
  const createSendTransport = () => {
    socket.emit("createWebRtcTransport", { consumer: false }, ({ params }) => {
      if (params.error) {
        console.log(params.error);
        return;
      }
      console.log("params", params);
      producerTransport = device.createSendTransport(params);
      producerTransport.on(
        "connect",
        async ({ dtlsParameters }, callback, errorback) => {
          try {
            await socket.emit("transport-connect", {
              // TransportId:producerTransport.id,
              dtlsParameters: dtlsParameters,
            });
            callback();
          } catch (error) {
            errorback(error);
          }
        }
      );
      producerTransport.on(
        "produce",
        async (parameters, callback, errorback) => {
          console.log(parameters);
          try {
            await socket.emit(
              "transport-produce",
              {
                // TransportId:producerTransport.id,
                kind: parameters.kind,
                rtpParameters: parameters.rtpParameters,
                appData: parameters.appData,
              },
              ({ id, producersExist }) => {
                callback({ id });
                if (producersExist) getProducers();
              }
            );
          } catch (error) {
            errorback(error);
          }
        }
      );
      connectSendTransport();
    });
  };
  // const connectSendTransport =async ()=>{
  //   console.log("params",params)
  //   producer = await producerTransport.produce(params)
  //   console.log(producer)
  //   producer.on('trackended',()=>{
  //     console.log('track ended')
  //   })
  //   producer.on('transportclose',()=>{
  //     console.log('transport ended')
  //   })
  // }

  const connectSendTransport = async () => {
    try {
      console.log("params", params);
      const stream = videoRef.current.srcObject;
      if (!stream) {
        console.error("No media stream found.");
        return;
      }

      const videoTrack = stream.getVideoTracks()[0];
      const audioTrack = stream.getAudioTracks()[0];
      console.log("tttttttttttttttt", videoTrack);
      console.log("pppppppppppppppp", audioTrack);
      if (!videoTrack) {
        console.error("No video track found.");
        return;
      }

      producer = await producerTransport.produce({
        track: videoTrack, // Attach video track
        ...params, // Pass other parameters like encodings and codecOptions
      });

      if (audioTrack) {
        const audioProducer = await producerTransport.produce({
          track: audioTrack,
          codecOptions: {
            opusStereo: true,
            opusDtx: true,
          },
        });

        audioProducer.on("trackended", () => {
          console.log("Audio track ended");
        });

        audioProducer.on("transportclose", () => {
          console.log("Audio transport closed");
        });
      }
      console.log("Producer created:", producer);

      producer.on("trackended", () => {
        console.log("Track ended");
      });

      producer.on("transportclose", () => {
        console.log("Transport closed");
      });
    } catch (error) {
      console.error("Error connecting send transport:", error);
    }
  };
  const signalNewConsumerTransport = async (remoteProducerId) => {
    //check if we are already consuming the remoteProducerId
    // debugger
    if (consumingTransports.includes(remoteProducerId)) return;
    consumingTransports.push(remoteProducerId);

    await socket.emit(
      "createWebRtcTransport",
      { consumer: true },
      ({ params }) => {
        // The server sends back params needed
        // to create Send Transport on the client side
        if (params.error) {
          console.log(params.error);
          return;
        }
        console.log(`PARAMS... ${params}`);

        let consumerTransport;
        try {
          consumerTransport = device.createRecvTransport(params);
        } catch (error) {
          // exceptions:
          // {InvalidStateError} if not loaded
          // {TypeError} if wrong arguments.
          console.log(error);
          return;
        }

        consumerTransport.on(
          "connect",
          async ({ dtlsParameters }, callback, errback) => {
            try {
              // Signal local DTLS parameters to the server side transport
              // see server's socket.on('transport-recv-connect', ...)
              await socket.emit("transport-recv-connect", {
                dtlsParameters,
                serverConsumerTransportId: params.id,
              });

              // Tell the transport that parameters were transmitted.
              callback();
            } catch (error) {
              // Tell the transport that something was wrong
              errback(error);
            }
          }
        );

        connectRecvTransport(consumerTransport, remoteProducerId, params.id);
      }
    );
  };

  const connectRecvTransport = async (
    consumerTransport,
    remoteProducerId,
    serverConsumerTransportId
  ) => {
    // debugger;
    socket.emit(
      "consume",
      {
        rtpCapabilities: device.rtpCapabilities,
        remoteProducerId,
        serverConsumerTransportId,
      },
      async ({ params }) => {
        if (params.error) {
          console.error("Error consuming:", params.error);
          return;
        }

        console.log("Consumer params:", params);

        try {
          // Create a consumer
          const consumer = await consumerTransport.consume({
            id: params.id,
            producerId: params.producerId,
            kind: params.kind,
            rtpParameters: params.rtpParameters,
          });

          console.log("Consumer created:", consumer);
          consumerTransports = [
            ...consumerTransports,
            {
              consumerTransport,
              serverConsumerTransportId: params.id,
              producerId: remoteProducerId,
              consumer,
            },
          ];

          const newElem = document.createElement("div");
          newElem.setAttribute("id", `td-${remoteProducerId}`);

          if (params.kind == "audio") {
            //append to the audio container
            newElem.innerHTML =
              '<audio id="' + remoteProducerId + '" autoPlay></audio>';
          } else {
            //append to the video container
            newElem.setAttribute("className", "remoteVideo");
            newElem.innerHTML =
              '<video id="' +
              remoteProducerId +
              '" autoPlay className="video" ></video>';
          }

          videoContainerRef.current.appendChild(newElem);
          // Get the track from the consumer
          const { track } = consumer;

          // if (remoteVideoRef.current) {
          //   // Set the track to the remote video element
          //   remoteVideoRef.current.srcObject = new MediaStream([track]);
          // }
          document.getElementById(remoteProducerId).srcObject = new MediaStream(
            [track]
          );
          // Notify the server to resume the consumer
          socket.emit("consumer-resume", {
            serverConsumerId: params.serverConsumerId,
          });
        } catch (error) {
          console.error("Error consuming track:", error);
        }
      }
    );
  };

  socket.on("producer-closed", ({ remoteProducerId }) => {
    const producerToClose = consumerTransports.find(
      (transportData) => transportData.producerId === remoteProducerId
    );

    if (producerToClose) {
      producerToClose.consumerTransport.close();
      producerToClose.consumer.close();
      consumerTransports = consumerTransports.filter(
        (transportData) => transportData.producerId !== remoteProducerId
      );

      // Remove the video element from the container
      const videoElem = document.getElementById(`td-${remoteProducerId}`);
      if (videoElem && videoContainerRef.current) {
        videoContainerRef.current.removeChild(videoElem);
      }
    }
  });

  return (
    <div>
      <h1>Conference Page</h1>
      {/* Button to start the video stream */}
      {/* {!isStreaming && (
        <button onClick={startVideoStream}>Start Video Stream</button>
      )}
      <button onClick={getRtpCapabilities}>getRtpCapabilities</button>
      <button onClick={createDevice}>createDevice</button>
      <button onClick={createSendTransport}>createSendTransport</button>
      <button onClick={connectSendTransport}>connectSendTransport</button>
      <button onClick={createRecvTransport}>createRecvTransport</button>
      <button onClick={connectRecvTransport}>connectRecvTransport</button> */}
      {/* Video element to display the local video stream */}
      {/* <button onClick={startVideoStream}>publicer</button>
      <button onClick={goConsume}>consume</button> */}
      {/* <div>
        <video
          ref={videoRef}
          style={{ width: "640px", height: "360px", border: "1px solid black" }}
          autoPlay
          playsInline
          muted // Muted to prevent echo from local stream
        />
      </div> */}
      {/* Remote Video */}
      {/* <div>
        <h2>Remote Stream</h2>
        <video
          ref={remoteVideoRef}
          style={{ width: "640px", height: "360px", border: "1px solid black" }}
          autoPlay
          playsInline
        />
      </div> */}
      <div id="video">
        <table className="mainTable">
          <tbody>
            <tr>
              <td className="localColumn">
                {/* <video id="localVideo" autoPlay className="video" muted></video> */}
                <video
                  ref={videoRef}
                  style={{
                    width: "640px",
                    height: "360px",
                    border: "1px solid black",
                  }}
                  autoPlay
                  playsInline
                  muted // Muted to prevent echo from local stream
                />
              </td>
              <td className="remoteColumn">
                <div id="videoContainer" ref={videoContainerRef}></div>
              </td>
            </tr>
          </tbody>
        </table>
        <table>
          <tbody>
            <tr>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ConferencePage;
