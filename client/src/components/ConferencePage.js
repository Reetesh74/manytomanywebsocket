import React, { useEffect, useRef, useState } from "react";
import io from "socket.io-client";
const mediaSoupClient = require("mediasoup-client");
const SERVER_URL = "http://localhost:3000";
const socket = io(SERVER_URL);
let device;

const roomName = window.location.pathname.split("/")[2];

const ConferencePage = ({ roomId }) => {
  const [isStreaming, setIsStreaming] = useState(false);
  const videoContainerRef = useRef(null);
  const videoRef = useRef(null);
  let producerTransport;
  let consumerTransports = [];
  let consumingTransports = [];
  let producer;
  let rtpCapabilities;
  let params = {
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
    codecOptions: {
      videoGoogleStartBitrate: 1000,
    },
  };

  useEffect(() => {
    // Listen for connection success
    socket.on("connection-success", ({ socketId }) => {
      startVideoStream();
    });

    // Clean up listener on unmount
    return () => {
      socket.off("connection-success");
    };
  }, []);

  const createDevice = async () => {
    try {
      device = new mediaSoupClient.Device();
      await device.load({
        routerRtpCapabilities: rtpCapabilities,
      });
      createSendTransport();
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
    socket.emit("joinRoom", { roomName }, (data) => {
      rtpCapabilities = data.rtpCapabilities;
      createDevice();
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
      producerTransport = device.createSendTransport(params);
      producerTransport.on(
        "connect",
        async ({ dtlsParameters }, callback, errorback) => {
          try {
            await socket.emit("transport-connect", {
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
          try {
            await socket.emit(
              "transport-produce",
              {
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

  const connectSendTransport = async () => {
    try {
      const stream = videoRef.current.srcObject;
      if (!stream) {
        console.error("No media stream found.");
        return;
      }

      const videoTrack = stream.getVideoTracks()[0];
      const audioTrack = stream.getAudioTracks()[0];

      if (!videoTrack) {
        console.error("No video track found.");
        return;
      }

      producer = await producerTransport.produce({
        track: videoTrack,
        ...params,
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
    if (consumingTransports.includes(remoteProducerId)) return;
    consumingTransports.push(remoteProducerId);

    await socket.emit(
      "createWebRtcTransport",
      { consumer: true },
      ({ params }) => {
        if (params.error) {
          console.log(params.error);
          return;
        }

        let consumerTransport;
        try {
          consumerTransport = device.createRecvTransport(params);
        } catch (error) {
          console.log(error);
          return;
        }

        consumerTransport.on(
          "connect",
          async ({ dtlsParameters }, callback, errback) => {
            try {
              await socket.emit("transport-recv-connect", {
                dtlsParameters,
                serverConsumerTransportId: params.id,
              });

              callback();
            } catch (error) {
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

          if (params.kind === "audio") {
            newElem.innerHTML =
              '<audio id="' + remoteProducerId + '" autoPlay></audio>';
          } else {
            newElem.setAttribute("className", "remoteVideo");
            newElem.innerHTML =
              '<video id="' +
              remoteProducerId +
              '" autoPlay className="video" ></video>';
          }

          videoContainerRef.current.appendChild(newElem);
          const { track } = consumer;

          document.getElementById(remoteProducerId).srcObject = new MediaStream(
            [track]
          );
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

      const videoElem = document.getElementById(`td-${remoteProducerId}`);
      if (videoElem && videoContainerRef.current) {
        videoContainerRef.current.removeChild(videoElem);
      }
    }
  });

  return (
    <div>
      <h1>Conference Page</h1>

      <div id="video">
        <table className="mainTable">
          <tbody>
            <tr>
              <td className="localColumn">
                <video
                  ref={videoRef}
                  style={{
                    width: "640px",
                    height: "360px",
                    border: "1px solid black",
                  }}
                  autoPlay
                  playsInline
                  muted
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
