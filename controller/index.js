const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);
const PORT = 8000;
const DeviceLister = require("nrf-device-lister");
const path = require("path");
const api = require("pc-ble-driver-js");
const adapterFactory = api.AdapterFactory.getInstance(undefined, { enablePolling: false });

const viewpath = __dirname.replace("controller", "view");
app.use(express.static(viewpath));
app.get("/", (req, res) => {
  res.send("connect");
});

const lister = new DeviceLister({
  usb: true,
  nordicUsb: false, // Like 'usb', but filters by VendorId
  seggerUsb: false, // Like 'usb', but filters by VendorId
  nordicDfu: false, // Like 'nordicUsb', but also looks for the Nordic DFU trigger interface
  serialport: true,
  jlink: true,
});

let kitList = {};
const FEEDBACK_SERVICE_UUID = "F000FEEA68656172746973656E7365AE";
const SENSORDATA_STREAM_CHAR_UUID = "F000FEEB68656172746973656E7365AE";
const DEVICE = "180A";
const BATTERY = "180F";
const STORAGE = "F000111068656172746973656E7365AE";
const ALERT = "1802";

class KitInfo {
  constructor(name) {
    this.name = name;
    this.connect = false;
    this.depth = null;
    this.breath = null;
    this.descriptorId = {
      SensorDataStream: null,
      BMP280SensorStatus: null,
    };
    this.characteristicId = {
      SensorDataStream: null,
      BMP280SensorStatus: null,
    };
    this.services = {
      feedback: null,
      device: null,
      battery: null,
      storage: null,
      alert: null,
    };
  }
}

class PortManager {
  constructor() {
    this.ports = [];
    this.adapters = [];
  }
  AddPorts(port) {
    this.ports.push(port);
    const adapter = adapterFactory.createAdapter("v3", port, "");

    this.adapters.push(adapter);
    addAdapterListener(adapter);

    openAdapter(adapter).then(() => {
      console.log("Opened adapter.");
    });
  }
  StartScan() {
    const scanParameters = {
      active: true,
      interval: 100,
      window: 50,
      timeout: 0,
    };
    this.adapters.forEach((curr) => {
      curr.startScan(scanParameters, (err) => {
        if (err) {
          console.log("start scan err");
        } else {
          console.log("portmanager.startscan");
        }
      });
    });
  }
  StopScan() {
    this.adapters.forEach((curr) => {
      curr.stopScan((err) => {
        if (err) {
          console.log("ERR : ", err);
        } else {
          console.log("portmanager.stopscan");
        }
      });
    });
  }

  StartSession() {
    Object.keys(kitList).forEach((addr) => {
      if (kitList[addr].descriptorId.SensorDataStream) {
        console.log("portmanager.startsession");

        //this.adapters[0].startCharacteristicsNotifications(kitList[addr].characteristicId.SensorDataStream, true, (err) => {
        //  if (err) {
        //    console.log("StartSession Error :", err);
        //  } else {
        //    console.log("😍ACK");

        this.adapters[0].writeDescriptorValue(kitList[addr].descriptorId.SensorDataStream, [1, 0], true, (err, byte) => {
          if (err) {
            console.log(err);
          } else {
          }

          //    });
          //  }
        });
      }
    });
  }

  StopSession() {
    Object.keys(kitList).forEach((addr) => {
      if (kitList[addr].descriptorId.SensorDataStream) {
        console.log("portmanager.stopsession");

        //this.adapters[0].startCharacteristicsNotifications(kitList[addr].characteristicId.SensorDataStream, true, (err) => {
        //  if (err) {
        //    console.log("StartSession Error :", err);
        //  } else {
        //    console.log("😍ACK");

        this.adapters[0].writeDescriptorValue(kitList[addr].descriptorId.SensorDataStream, [0, 0], true, (err, byte) => {
          if (err) {
            console.log(err);
          } else {
          }

          //    });
          //  }
        });
      }
    });
  }

  GetChracteristic(address, serviceId) {
    this.adapters[0].getCharacteristics(serviceId, (err, characteristics) => {
      // process.stdout.write("\u001b[2J\u001b[0;0H");

      characteristics.forEach((characteristic) => {
        if (characteristic.uuid === SENSORDATA_STREAM_CHAR_UUID) {
          this.adapters[0].getDescriptors(characteristic.instanceId, (err, descriptors) => {
            descriptors.forEach((descriptor) => {
              kitList[address].descriptorId.SensorDataStream = descriptor.instanceId;
            });
          });
          kitList[address].characteristicId.SensorDataStream = characteristic.instanceId;
        }
      });
    });
  }

  GetService(address, instanceID) {
    this.adapters[0].getServices(instanceID, (err, service) => {
      if (!err) {
        for (let i = 0; i < service.length; i++) {
          switch (service[i].uuid) {
            case FEEDBACK_SERVICE_UUID:
              kitList[address].services.feedback = service[i];
              const { instanceId: serviceId } = service[i];

              this.GetChracteristic(address, serviceId);

              break;
            case DEVICE:
              kitList[address].services.device = service[i];
              break;
            case BATTERY:
              kitList[address].services.battery = service[i];
              break;
            case STORAGE:
              kitList[address].services.storage = service[i];
              break;
            case ALERT:
              kitList[address].services.alert = service[i];
              break;
          }
        }
      }
    });
  }
  StopConnect() {
    this.adapters[0].connReset((...args) => {});
  }

  StartConnect() {
    const scanParameters = {
      active: true,
      interval: 100,
      window: 50,
      timeout: 0,
    };
    const connParams = {
      min_conn_interval: 7.5,
      max_conn_interval: 7.5,
      slave_latency: 10,
      conn_sup_timeout: 4000,
    };
    const params = {
      scanParams: scanParameters,
      connParams: connParams,
    };

    const disconnectList = Object.keys(kitList).filter((curr) => kitList[curr].connect === false);

    if (disconnectList[0]) {
      this.adapters[0].connect(disconnectList[0], params, () => {
        this.StartConnect();
      });
    }
    //this.adapters.forEach((adapter) => {
    //  Object.keys(kitList)
    //    .slice(0, 2)
    //    .forEach((kitaddr) => {
    //      adapter.connect(
    //        {
    //          address: kitaddr,
    //          type: "BLE_GAP_ADDR_TYPE_RANDOM_STATIC",
    //        },
    //        params,
    //        (err) => {
    //          if (err) {
    //            console.log("Startconnect error");
    //          } else {
    //            console.log("portmanager.startConnect");
    //          }
    //        }
    //      );
    //    });
    //});
  }
}
const portmanager = new PortManager();
function addAdapterListener(adapter) {
  /**
   * Handling error and log message events from the adapter.
   */
  adapter.on("logMessage", (severity, message) => {
    //console.log(severity);
    //console.log(message);
    if (severity > 3) console.log(`${message}.`);
  });
  adapter.on("error", (error) => {
    console.log(`error: ${JSON.stringify(error, null, 1)}.`);
  });

  /**
   * Handling the Application's BLE Stack events.
   */
  adapter.on("deviceConnected", (device) => {
    console.log(`Device ${device.address}/${device.addressType} connected.`);
    kitList[device.address].connect = true;
    io.emit("discovered", kitList);
    //process.stdout.write("\u001b[2J\u001b[0;0H");
    const { instanceId, address } = device;
    //console.log(instanceId);
    Object.values(kitList).filter((kit) => kit.connect === true);
    portmanager.GetService(address, instanceId);
  });

  adapter.on("deviceDisconnected", (device) => {
    console.log(`Device ${device.address} disconnected.`);
    kitList[device.address].connect = false;
    io.emit("discovered", kitList);
  });

  adapter.on("deviceDiscovered", (device) => {
    //process.stdout.write("\u001b[2J\u001b[0;0H");

    if ("adData" in device) {
      const { adData } = device;
      if (adData && "BLE_GAP_AD_TYPE_COMPLETE_LOCAL_NAME" in adData) {
        const { address } = device;
        //console.log(device);
        let { BLE_GAP_AD_TYPE_COMPLETE_LOCAL_NAME: name, BLE_GAP_AD_TYPE_SOLICITED_SERVICE_UUIDS_16BIT: serviceID } = adData;
        //uuid가 fe(254)ea(234) 인 경우에만 리스트에 추가
        if (serviceID && serviceID[0] === 234 && serviceID[1] === 254) {
          serviceID = serviceID.reduce((acc, curr) => {
            acc = curr.toString(16) + acc;
            return acc;
          }, "");

          if (!(address in kitList)) {
            kitList[address] = new KitInfo(name);
          }
        } else {
        }
        console.log("Kit Total Search : ", Object.keys(kitList).length);
        io.emit("discovered", kitList);
      }
    }
  });

  adapter.on("scanTimedOut", () => {
    console.log("scanTimedOut: Scanning timed-out. Exiting.");
    process.exit(1);
  });

  adapter.on("characteristicValueChanged", (data) => {
    const { value } = data;
    const [targetKitAddr] = data.instanceId.split(".");
    const depthData = value.slice(1, 5);
    let breathData = [value.slice(5, 7).reverse(), value.slice(7).reverse()];
    breathData = breathData.map((breath) => {
      return breath.reduce((acc, curr) => (acc = acc * 256 + curr));
    });

    kitList[targetKitAddr].depth = depthData;
    kitList[targetKitAddr].breath = breathData;
    io.emit("discovered", kitList);
  });

  //adapter.on("deviceNotifiedOrIndicated", (...args) => {
  //  console.log("return data :", args);
  //});
}

/**
 * Opens adapter for use with the default options.
 *
 * @param {Adapter} adapter Adapter to be opened.
 * @returns {Promise} Resolves if the adapter is opened successfully.
 *                    If an error occurs, rejects with the corresponding error.
 */
function openAdapter(adapter) {
  return new Promise((resolve, reject) => {
    const baudRate = 1000000;
    console.log(`Opening adapter with ID: ${adapter.instanceId} and baud rate: ${baudRate}...`);

    adapter.open({ baudRate, logLevel: "debug" }, (err) => {
      if (err) {
        reject(Error(`Error opening adapter: ${err}.`));
      }

      resolve();
    });
  });
}

lister.on("conflated", function (deviceMap) {
  console.log("😁List Updated! : ");
  console.log(deviceMap);
  deviceMap.forEach((value, key, map) => {
    const { serialport } = value;
    const { path } = serialport;
    portmanager.AddPorts(path);
  });
});

lister.on("error", function (err) {
  // `err` is an instance of Error
  console.error(err.message + " (error code: " + err.errorCode + ")");

  // Optionally, if the error originated from a USB device, there will
  // be an `usb` property with an instance of `usb`'s `Device`:
  if (err.usb) {
    console.error(
      "Error originated from USB device " + "VID: " + err.usb.deviceDescriptor.idVendor + " " + "PID: " + err.usb.deviceDescriptor.idProduct
    );
  }

  // Optionally, if the error originated from a serial port, there will
  // be an `serialport` property with the serial port metadata:
  if (err.serialport) {
    console.error("Error originated from serial port device at " + err.serialport.path);
  }
});

lister.start();

io.on("connection", (socket) => {
  console.log("a user in");
  socket.on("scan-start", () => {
    portmanager.StartScan();
    io.emit("state", "startscan");
  });
  socket.on("scan-stop", () => {
    portmanager.StopScan();
  });
  socket.on("connect-start", () => {
    portmanager.StartConnect();
    io.emit("state", "startconnect");
  });
  socket.on("connect-stop", () => {
    portmanager.StopConnect();
    console.log("come");
  });
  socket.on("session-start", () => {
    portmanager.StartSession();
  });
  socket.on("session-stop", () => {
    portmanager.StopSession();
  });
});

http.listen(PORT, () => {
  console.log(`${PORT} is listen...`);
});
