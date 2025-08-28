module.exports = function (RED) {
    function CaptureNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        node.client = RED.nodes.getNode(config.client);
        node.config = {
            storage: config.storage,
            interval: +config.interval * Math.pow(60, Number(config.timeUnit)),
            enabled: config.startMode === "immediate",
            saveMode: "image",
        };
        let intervalHandle = null;

        function performCapture() {
            if (node.client) {
                node.client.request(node.id, "capture", true);
            }
        }

        function startInterval() {
            stopInterval();
            const seconds = Number(node.config.interval) || 0;
            if (seconds <= 0) {
                return;
            }
            intervalHandle = setInterval(performCapture, seconds * 1000);
            // Optional: immediately capture once on enable
            performCapture();
        }

        function stopInterval() {
            if (intervalHandle) {
                clearInterval(intervalHandle);
                intervalHandle = null;
            }
        }

        node.on("input", function (msg) {
            if (msg.hasOwnProperty("enabled")) {
                node.client.request(node.id, "enabled", msg.enabled);
                if (msg.enabled === true) {
                    startInterval();
                } else {
                    stopInterval();
                }
            }
            if (msg.payload === "capture") {
                performCapture();
            }
        });

        node.message = function (msg) {
            node.send(msg);
        };

        if (node.client) {
            node.client.register(node);
        }

        // Start interval if configured to start immediately
        if (node.config.enabled) {
            startInterval();
        }

        node.on("close", function (removed, done) {
            if (node.client) {
                node.client.deregister(node, done, removed);
                node.client = null;
            }
            stopInterval();
            done();
        });
    }

    RED.nodes.registerType("capture", CaptureNode);
};
