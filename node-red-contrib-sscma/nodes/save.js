module.exports = function (RED) {
    function SaveNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        node.client = RED.nodes.getNode(config.client);
        node.config = {
            saveMode: config.saveMode || "video",
            storage: config.storage,
            slice: +config.slice * Math.pow(60, Number(config.timeUnit)),
            duration: +config.duration * Math.pow(60, Number(config.durationUnit)),
            enabled: config.start,
        };
        node.on("input", function (msg) {
            if (msg.hasOwnProperty("enabled")) {
                node.client.request(node.id, "enabled", msg.enabled);
            }
            
            // Handle manual capture for image mode
            if (node.config.saveMode === "image" && node.config.duration === 0) {
                // Check if message contains capture command
                if (msg.payload === "capture") {
                    // Send capture command to backend
                    node.client.request(node.id, "capture", true);
                }
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
                node.client = null;
            }
            done();
        });
    }

    RED.nodes.registerType("save", SaveNode);
};
