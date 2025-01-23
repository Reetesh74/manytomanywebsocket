const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const mediasoup = require("mediasoup");
const { v4: uuidv4 } = require("uuid");
const cors = require("cors");
const { listeners } = require("process");

const app = express();
const server = http.createServer(app);

// CORS Configuration
app.use(
  cors({
    origin: "http://localhost:3001", // Client URL
    methods: ["GET", "POST"],
  })
);

const connections = socketIo(server, {
  cors: {
    origin: "http://localhost:3001",
    methods: ["GET", "POST"],
  },
});

app.post("/createMeeting", (req, res) => {
  const roomId = uuidv4();
  peers[roomId] = [];
  res.json({ roomId });
});
let producer;
let worker;
let router;
let consumerTransport;
let producerTransport;
let consumer;
let rooms = {};
let peers = {};
let transports = [];
let producers = [];
let consumers = [];

// Create Worker
const createWorker = async () => {
  worker = await mediasoup.createWorker({
    rtcMinPort: 2000,
    rtcMaxPort: 2100,
  });

  console.log(`worker pid ${worker.pid}`);

  worker.on("died", () => {
    console.error("mediasoup worker has died");
    setTimeout(() => process.exit(1), 2000);
  });

  return worker;
};

// Initialize Worker
const initializeWorker = async () => {
  worker = await createWorker();
};
initializeWorker();

// Media Codecs
const mediaCodecs = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: "video",
    mimeType: "video/VP8",
    clockRate: 90000,
    parameters: {
      "x-google-start-bitrate": 1000,
    },
  },
];

// Socket Connection
connections.on("connection", async (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Check if the worker is initialized
  if (!worker) {
    console.error("Worker is not initialized yet.");
    socket.emit("error", { message: "Media worker is not ready yet." });
    return;
  }

  try {
    // Create a router for each connection if it doesn't exist

    // if (!router) {
    //   router = await worker.createRouter({ mediaCodecs });
    //   console.log("Router created successfully");
    // }
    // socket.on("getRtpCapabilities", (callback) => {
    //   const rtpCapabilities = router.rtpCapabilities;
    //   console.log("rtpCapabilities", rtpCapabilities);
    //   callback({ rtpCapabilities });
    // });
    // Emit connection success
    socket.emit("connection-success", {
      socketId: socket.id,
    });
    const removeItems = (items, socketId, type) => {
      items.forEach((item) => {
        if (item.socketId === socket.id) {
          item[type].close();
        }
      });
      items = items.filter((item) => item.socketId !== socket.id);
  
      return items;
    };
    socket.on("disconnect", () => {
      console.log("peer disconnected");
    
      // Ensure peers[socket.id] exists before accessing it
      if (peers[socket.id]) {
        const { roomName } = peers[socket.id];
    
        consumers = removeItems(consumers, socket.id, "consumer");
        producers = removeItems(producers, socket.id, "producer");
        transports = removeItems(transports, socket.id, "transport");
    
        delete peers[socket.id];
    
        if (rooms[roomName]) {
          rooms[roomName] = {
            router: rooms[roomName].router,
            peers: rooms[roomName].peers.filter(
              (peerSocketId) => peerSocketId !== socket.id
            ),
          };
        }
      } else {
        console.warn(`No peer data found for socket ID: ${socket.id}`);
      }
    });
    
    socket.on("joinRoom", async ({ roomName }, callback) => {
      const router1 = await createRoom(roomName, socket.id);
    
      // Ensure peers[socket.id] is initialized here
      peers[socket.id] = {
        socket,
        roomName, // Assign room name
        transports: [],
        producers: [],
        consumers: [],
        peerDetails: {
          name: "",
          isAdmin: false, // Example metadata
        },
      };
    
      const rtpCapabilities = router1.rtpCapabilities;
      callback({ rtpCapabilities });
    });
    

    const createRoom = async (roomName, socketId) => {
      let router1;
      let peers = [];
      if (rooms[roomName]) {
        router1 = rooms[roomName].router;
        peers = rooms[roomName].peers || [];
      } else {
        router1 = await worker.createRouter({ mediaCodecs });
      }

      console.log(`Router ID: ${router1.id}`, peers.length);

      rooms[roomName] = {
        router: router1,
        peers: [...peers, socketId],
      };

      return router1;
    };

    // socket.on("createRoom", async (callback) => {
    //   if (router === undefined) {
    //     router = await worker.createRouter({ mediaCodecs });
    //     console.log("Router created successfully");
    //   }
    //   const rtpCapabilities = router.rtpCapabilities;
    //   console.log("rrrrrrrrrrrrrrrrrrrr", rtpCapabilities);
    //   callback({ rtpCapabilities });
    // });
    // const getRtpCapabilities = (callback) => {
    //   const getRtpCapabilities = router.rtpCapabilities;
    //   callback({ getRtpCapabilities });
    // };
    socket.on("createWebRtcTransport", async ({ consumer }, callback) => {
      // get Room Name from Peer's properties
      const roomName = peers[socket.id].roomName;

      // get Router (Room) object this peer is in based on RoomName
      const router = rooms[roomName].router;

      createWebRtcTransport(router).then(
        (transport) => {
          callback({
            params: {
              id: transport.id,
              iceParameters: transport.iceParameters,
              iceCandidates: transport.iceCandidates,
              dtlsParameters: transport.dtlsParameters,
            },
          });

          // add transport to Peer's properties
          addTransport(transport, roomName, consumer);
        },
        (error) => {
          console.log(error);
        }
      );
    });

    const addTransport = (transport, roomName, consumer) => {
      transports = [
        ...transports,
        { socketId: socket.id, transport, roomName, consumer },
      ];

      peers[socket.id] = {
        ...peers[socket.id],
        transports: [...peers[socket.id].transports, transport.id],
      };
    };

    const addProducer = (producer, roomName) => {
      producers = [...producers, { socketId: socket.id, producer, roomName }];

      peers[socket.id] = {
        ...peers[socket.id],
        producers: [...peers[socket.id].producers, producer.id],
      };
    };

    const addConsumer = (consumer, roomName) => {
      // add the consumer to the consumers list
      consumers = [...consumers, { socketId: socket.id, consumer, roomName }];

      // add the consumer id to the peers list
      peers[socket.id] = {
        ...peers[socket.id],
        consumers: [...peers[socket.id].consumers, consumer.id],
      };
    };

    socket.on("getProducers", (callback) => {
      //return all producer transports
      const { roomName } = peers[socket.id];

      let producerList = [];
      producers.forEach((producerData) => {
        if (
          producerData.socketId !== socket.id &&
          producerData.roomName === roomName
        ) {
          producerList = [...producerList, producerData.producer.id];
        }
      });

      // return the producer list back to the client
      callback(producerList);
    });

    const informConsumers = (roomName, socketId, id) => {
      console.log(`just joined, id ${id} ${roomName}, ${socketId}`);
      // A new producer just joined
      // let all consumers to consume this producer
      producers.forEach((producerData) => {
        if (
          producerData.socketId !== socketId &&
          producerData.roomName === roomName
        ) {
          const producerSocket = peers[producerData.socketId].socket;
          // use socket to send producer id to producer
          producerSocket.emit("new-producer", { producerId: id });
        }
      });
    };

    const getTransport = (socketId) => {
      const [producerTransport] = transports.filter(
        (transport) => transport.socketId === socketId && !transport.consumer
      );
      return producerTransport.transport;
    };

    socket.on("transport-connect", ({ dtlsParameters }) => {
      console.log("DTLS PARAMS... ", { dtlsParameters });

      getTransport(socket.id).connect({ dtlsParameters });
    });

    // socket.on(
    //   "tranport-produce",
    //   async ({ kind, rtpParameters, appdata }, callback) => {
    //     producer = await producerTransport.produce({
    //       kind,
    //       rtpParameters,
    //     });
    //     console.log("producer ID", producer.id, producer.kind);
    //     producer.on("transportclose", () => {
    //       console.log("transport for this producer closed");
    //       producer.close();
    //     });
    //     callback({
    //       id: producer.id,
    //     });
    //   }
    // );
    socket.on(
      "transport-produce",
      async ({ kind, rtpParameters, appData }, callback) => {
        // call produce based on the prameters from the client
        const producer = await getTransport(socket.id).produce({
          kind,
          rtpParameters,
        });

        // add producer to the producers array
        const { roomName } = peers[socket.id];

        addProducer(producer, roomName);

        informConsumers(roomName, socket.id, producer.id);

        console.log("Producer ID: ", producer.id, producer.kind);

        producer.on("transportclose", () => {
          console.log("transport for this producer closed ");
          producer.close();
        });

        // Send back to the client the Producer's id
        callback({
          id: producer.id,
          producersExist: producers.length > 1 ? true : false,
        });
      }
    );

    socket.on(
      "transport-recv-connect",
      async ({ dtlsParameters, serverConsumerTransportId }) => {
        console.log(`DTLS PARAMS: ${dtlsParameters}`);
        const consumerTransport = transports.find(
          (transportData) =>
            transportData.consumer &&
            transportData.transport.id == serverConsumerTransportId
        ).transport;
        await consumerTransport.connect({ dtlsParameters });
      }
    );

    // socket.on("consume", async ({ rtpCapabilities }, callback) => {
    //   try {
    //     if (
    //       router.canConsume({
    //         producerId: producer.id,
    //         rtpCapabilities,
    //       })
    //     ) {
    //       consumer = await consumerTransport.consume({
    //         producerId: producer.id,
    //         rtpCapabilities,
    //         paused: true,
    //       });
    //       consumer.on("transportclose", () => {
    //         console.log("transport close from consumer");
    //       });
    //       consumer.on("producerclose", () => {
    //         console.log("producer of consumer closed");
    //       });

    //       const params = {
    //         id: consumer.id,
    //         producerId: producer.id,
    //         kind: consumer.kind,
    //         rtpParameters: consumer.rtpParameters,
    //       };
    //       callback({ params });
    //     }
    //   } catch (error) {
    //     console.log(error.message);
    //     callback({
    //       params: {
    //         error: error,
    //       },
    //     });
    //   }
    // });
    socket.on(
      "consume",
      async (
        { rtpCapabilities, remoteProducerId, serverConsumerTransportId },
        callback
      ) => {
        try {
          const { roomName } = peers[socket.id];
          const router = rooms[roomName].router;
          let consumerTransport = transports.find(
            (transportData) =>
              transportData.consumer &&
              transportData.transport.id == serverConsumerTransportId
          ).transport;

          if (
            router.canConsume({
              producerId: remoteProducerId,
              rtpCapabilities,
            })
          ) {
            const consumer = await consumerTransport.consume({
              producerId: remoteProducerId,
              rtpCapabilities,
              paused: true,
            });

            consumer.on("transportclose", () => {
              console.log("transport close from consumer");
            });

            consumer.on("producerclose", () => {
              console.log("producer of consumer closed");
              socket.emit("producer-closed", { remoteProducerId });

              consumerTransport.close([]);
              transports = transports.filter(
                (transportData) =>
                  transportData.transport.id !== consumerTransport.id
              );
              consumer.close();
              consumers = consumers.filter(
                (consumerData) => consumerData.consumer.id !== consumer.id
              );
            });

            addConsumer(consumer, roomName);

            const params = {
              id: consumer.id,
              producerId: remoteProducerId,
              kind: consumer.kind,
              rtpParameters: consumer.rtpParameters,
              serverConsumerId: consumer.id,
            };

            // send the parameters to the client
            callback({ params });
          }
        } catch (error) {
          console.log(error.message);
          callback({
            params: {
              error: error,
            },
          });
        }
      }
    );
    socket.on("consumer-resume", async ({ serverConsumerId }) => {
      console.log("consumer resume");
      const { consumer } = consumers.find(
        (consumerData) => consumerData.consumer.id === serverConsumerId
      );
      await consumer.resume();
    });

    const createWebRtcTransport = async (router) => {
      return new Promise(async (resolve, reject) => {
        try {
          // https://mediasoup.org/documentation/v3/mediasoup/api/#WebRtcTransportOptions
          const webRtcTransport_options = {
            listenIps: [
              {
                ip: "192.168.31.182", // replace with relevant IP address
                // announcedIp: "10.0.0.115",
              },
            ],
            enableUdp: true,
            enableTcp: true,
            preferUdp: true,
          };

          // https://mediasoup.org/documentation/v3/mediasoup/api/#router-createWebRtcTransport
          let transport = await router.createWebRtcTransport(
            webRtcTransport_options
          );
          console.log(`transport id: ${transport.id}`);

          transport.on("dtlsstatechange", (dtlsState) => {
            if (dtlsState === "closed") {
              transport.close();
            }
          });

          transport.on("close", () => {
            console.log("transport closed");
          });

          resolve(transport);
        } catch (error) {
          reject(error);
        }
      });
    };
  } catch (error) {
    console.error("Error creating router:", error);
    socket.emit("error", { message: "Error creating router." });
  }
});

// Start Server
server.listen(3000, () => {
  console.log("Server is running on http://localhost:3000");
});
