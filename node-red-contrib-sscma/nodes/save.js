module.exports = function (RED) {
    function SaveNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        node.client = RED.nodes.getNode(config.client);
        node.config = {
            storage: config.storage,
            slice: +config.slice * Math.pow(60, Number(config.timeUnit)),
            duration: +config.duration * Math.pow(60, Number(config.durationUnit)),
            enabled: config.startMode === "immediate" || !config.startMode, // Default to true if startMode is undefined
            saveMode: "video",
        };
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
                node.client = null;
            }
            done();
        });
    }

    RED.nodes.registerType("save", SaveNode);
};
