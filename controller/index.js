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

class KitInfo {
  constructor(name) {
    this.name = name;
    this.connect = false;
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

  StartConnect() {
    const scanParameters = {
      active: false,
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
    //console.log(disconnectList);

    this.adapters[0].connect(disconnectList[0], params, () => {
      this.StartConnect();
    });
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
    process.stdout.write("\u001b[2J\u001b[0;0H");
    console.log(device);
    const connectSuccess = Object.values(kitList).filter((kit) => kit.connect === true);
    console.log(connectSuccess);
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
        const { _address } = device;
        const { BLE_GAP_AD_TYPE_COMPLETE_LOCAL_NAME: name } = adData;
        if (!(_address in kitList)) {
          kitList[_address] = new KitInfo(name);
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

  adapter.on("characteristicValueChanged", (attribute) => {
    if (attribute.uuid === BLE_UUID_HEART_RATE_MEASUREMENT_CHAR) {
      console.log(`Received heart rate measurement: ${attribute.value}.`);
    }
  });
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

    adapter.open({ baudRate, logLevel: "error" }, (err) => {
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
    console.log("come");
  });
  socket.on("session-start", () => {
    console.log("come");
  });
  socket.on("session-stop", () => {
    console.log("come");
  });
});

http.listen(PORT, () => {
  console.log(`${PORT} is listen...`);
});
