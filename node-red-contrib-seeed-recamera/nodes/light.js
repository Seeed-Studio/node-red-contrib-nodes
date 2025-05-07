const http = require("http");

module.exports = function (RED) {
    "use strict";

    /**
     * Send HTTP request to control the camera light
     * @param {string} state - Light state ("on" or "off")
     * @returns {Promise<void>}
     */
    function sendLightRequest(state) {
        return new Promise((resolve, reject) => {
            const req = http.request(
                {
                    method: "POST",
                    path: `/camera/${state}`,
                    port: 1880,
                    host: "localhost",
                },
                (res) => {
                    // Handle response
                    if (res.statusCode === 200) {
                        resolve();
                    } else {
                        reject(new Error(`HTTP error: ${res.statusCode}`));
                    }
                },
            );

            // Handle request errors
            req.on("error", (err) => {
                reject(err);
            });

            // Complete the request
            req.end();
        });
    }

    /**
     * Light Node implementation
     * @param {Object} config - Node configuration
     */
    function LightNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Initialize node properties
        node.light = config.light;

        // Set initial light state on deploy
        sendLightRequest(node.light ? "on" : "off")
            .then(() => {
                node.status({
                    fill: "green",
                    shape: "dot",
                    text: node.light ? "Light is on" : "Light is off",
                });
            })
            .catch((err) => {
                node.status({
                    fill: "red",
                    shape: "ring",
                    text: `Error: ${err.message}`,
                });
            });

        // Handle input messages
        node.on("input", function (msg) {
            // Determine light state from message payload
            let newState = "off";
            if (msg.payload === "on" || (!!msg.payload && msg.payload !== "off")) {
                newState = "on";
            }

            // Only send request if state has changed
            if ((newState === "on") !== node.light) {
                node.light = newState === "on";

                // Update light state
                sendLightRequest(newState)
                    .then(() => {
                        node.status({
                            fill: "green",
                            shape: "dot",
                            text: node.light ? "Light is on" : "Light is off",
                        });

                        RED.comms.publish("light-state", {
                            id: node.id,
                            state: node.light,
                        });
                    })
                    .catch((err) => {
                        node.status({
                            fill: "red",
                            shape: "ring",
                            text: `Error: ${err.message}`,
                        });
                    });
            }
        });

        // Handle HTTP requests from the editor button
        RED.httpAdmin.post("/light/:state", RED.auth.needsPermission("light.write"), function (req, res) {
            try {
                const state = req.params.state;
                if (state !== "on" && state !== "off") {
                    res.status(400).send("Invalid state. Use 'on' or 'off'");
                    return;
                }

                // Find all light-type nodes
                let lightNodes = [];
                RED.nodes.eachNode((lNode) => {
                    if (lNode.type === "light") {
                        lightNodes.push(RED.nodes.getNode(lNode.id));
                    }
                });

                if (lightNodes.length === 0) {
                    res.status(404).send("No light nodes found");
                    return;
                }

                // Process requests for all light nodes
                const promises = lightNodes.map((lightNode) => {
                    if (lightNode) {
                        // Update node state
                        lightNode.light = state === "on";

                        // Send request
                        return sendLightRequest(state)
                            .then(() => {
                                lightNode.status({
                                    fill: "green",
                                    shape: "dot",
                                    text: lightNode.light ? "Light is on" : "Light is off",
                                });
                            })
                            .catch((err) => {
                                lightNode.status({
                                    fill: "red",
                                    shape: "ring",
                                    text: `Error: ${err.message}`,
                                });
                                throw err; // Re-throw error so Promise.all can catch it
                            });
                    }
                    return Promise.resolve(); // Return resolved Promise if node is null
                });

                // Wait for all requests to complete
                Promise.all(promises)
                    .then(() => {
                        res.send(state); // Send success response
                    })
                    .catch((err) => {
                        res.status(500).send(`Error controlling light: ${err.message}`);
                    });
            } catch (error) {
                res.status(500).send(error.message);
            }
        });
    }

    // Register the node type
    RED.nodes.registerType("light", LightNode);
};
