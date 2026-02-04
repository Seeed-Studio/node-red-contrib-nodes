const http = require("http");

module.exports = function (RED) {
    "use strict";

    /**
     * Send HTTP request to get battery info
     * @returns {Promise<Object>}
     */
    function getBatteryInfo() {
        return new Promise((resolve, reject) => {
            const req = http.request(
                {
                    method: "GET",
                    path: "/api/deviceMgr/queryBatteryInfo",
                    port: 80,
                    host: "127.0.0.1",
                    agent: false,
                },
                (res) => {
                    let data = "";
                    res.on("data", (chunk) => (data += chunk));
                    res.on("end", () => {
                        if (res.statusCode === 200) {
                            try {
                                const json = JSON.parse(data);
                                resolve(json);
                            } catch (e) {
                                reject(new Error(`Parse error: ${e.message}`));
                            }
                        } else {
                            reject(new Error(`HTTP error: ${res.statusCode}`));
                        }
                    });
                }
            );

            req.on("error", (err) => {
                reject(err);
            });

            req.end();
        });
    }

    function GetBatteryVoltageNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Configuration
        node.interval = (parseInt(config.interval) || 1) * 1000;
        node.unit = config.unit || "V";
        let timer = null;

        node.status({ fill: "yellow", shape: "ring", text: "Initializing..." });

        function checkBattery() {
            getBatteryInfo()
                .then((json) => {
                    let voltage = 0;
                    // Robust parsing for various potential JSON structures
                    if (json.data && json.data.voltage !== undefined) {
                        voltage = parseFloat(json.data.voltage);
                    } else if (json.voltage !== undefined) {
                        voltage = parseFloat(json.voltage);
                    } else if (typeof json.data === "number") {
                        voltage = json.data;
                    }

                    // Fixed scale for mV to V conversion
                    const finalVoltage = voltage * 0.001;
                    
                    // Update status
                    node.status({
                        fill: "green",
                        shape: "dot",
                        text: `${finalVoltage.toFixed(2)} ${node.unit}`,
                    });

                    // Send message
                    node.send({
                        payload: finalVoltage,
                        original: json,
                        topic: "battery_voltage",
                    });
                })
                .catch((err) => {
                    node.error(`Battery read error: ${err.message}`);
                    node.status({
                        fill: "red",
                        shape: "ring",
                        text: `Error: ${err.message}`,
                    });
                });
        }

        // Initial check
        checkBattery();
        
        // Periodic check
        timer = setInterval(checkBattery, node.interval);

        node.on("close", function () {
            if (timer) clearInterval(timer);
        });
        
        // Optional: Allow manual trigger if input is wired
        node.on("input", function(msg) {
             checkBattery();
        });
    }

    RED.nodes.registerType("get-battery-voltage", GetBatteryVoltageNode);
};
