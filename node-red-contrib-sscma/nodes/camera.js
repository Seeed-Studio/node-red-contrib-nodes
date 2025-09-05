/**
 * @typedef {import('node-red')} NodeRED
 * @typedef {import('node-red').Node} Node
 * @typedef {import('node-red').NodeDef} NodeDef
 */

/**
 * @param {NodeRED} RED - Node-RED 实例
 */
module.exports = function (RED) {
    "use strict";

    function CameraNode(n) {
        RED.nodes.createNode(this, n);
        const node = this;
        node.client = RED.nodes.getNode(n.client);

        node.config = {
            option: parseInt(n.option),
            fps: parseInt(n.fps),
            preview: false,
            websocket: false,
            mirror: n.mirror ? true : false,
            flip: n.flip ? true : false,
            audio: n.audio ? (isNaN(parseInt(n.volume)) ? 80 : parseInt(n.volume)) : 0,
        };

        // if connect to preview, set preview to true
        node.wires.forEach((wires) => {
            wires.forEach((wire) => {
                RED.nodes.eachNode(function (n) {
                    if (n.id === wire && n.type === "preview" && !n.d) {
                        node.config.websocket = true;
                    }
                });
            });
        });

        node.on("input", function (msg) {
            if (msg.hasOwnProperty("enabled")) {
                node.client.request(node.id, "enabled", msg.enabled);
            }
        });

        node.message = function (msg) {
            node.send(msg);
        };

        if (node.client) {
            node.client.register(node);
        }

        node.on("close", function (removed, done) {
            if (node.client) {
                node.client.deregister(node, done, removed);
            } else {
                done();
            }
        });
        // Via the button on the node (in the FLOW EDITOR), the image pushing can be enabled or disabled
        RED.httpAdmin.post("/camera/:state", RED.auth.needsPermission("camera.write"), function (req, res) {
            try {
                let id = null;
                const state = req.params.state;
                RED.nodes.eachNode((lNode) => {
                    if (lNode.type === "camera") {
                        id = lNode.id;
                    }
                });
                const node = RED.nodes.getNode(id);
                if (node === null) {
                    res.status(404).send("Node not found");
                    return;
                }
                if (state == "pause") {
                    node.client.request(id, "pause", true);
                    res.send("pause");
                    return;
                } else if (state == "start") {
                    node.client.request(id, "pause", false);
                    res.send("start");
                    return;
                } else if (state == "on" || state == "off") {
                    const status = state === "on" ? 1 : 0;
                    node.client.request(id, "light", status);
                    res.send(status ? "on" : "off");
                }
            } catch (error) {
                res.status(500).send(error.message);
            }
        });
    }

    RED.nodes.registerType("camera", CameraNode);
};
