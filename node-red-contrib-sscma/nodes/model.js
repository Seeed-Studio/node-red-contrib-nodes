module.exports = function (RED) {
    function ModelNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        node.client = RED.nodes.getNode(config.client);
        node.config = {
            uri: config.uri,
            tiou: parseFloat(config.tiou),
            tscore: parseFloat(config.tscore),
            trace: config.trace,
            debug: config.debug,
            counting: config.counting,
            splitter: config.splitter
                .split(",")
                .filter(Boolean)
                .map((c) => parseInt(c.trim())),
            labels: config.classes
                .split(",")
                .filter(Boolean)
                .map((c) => c.trim()),
        };

        node.on("input", function (msg) {
            try {
                if (msg.hasOwnProperty("enabled")) {
                    node.client.request(node.id, "enabled", msg.enabled);
                } else {
                    if (typeof msg.payload !== "object") {
                        return msg;
                    }
                    const { tiou, tscore, trace, debug, counting, splitter, labels } = msg.payload ?? {};
                    const config = {};
                    if (typeof tiou === "number") {
                        config.tiou = tiou;
                    }
                    if (typeof tscore === "number") {
                        config.tscore = tscore;
                    }
                    if (typeof trace === "boolean") {
                        config.trace = trace;
                    }
                    if (typeof debug === "boolean") {
                        config.debug = debug;
                    }
                    if (typeof counting === "boolean") {
                        config.counting = counting;
                    }
                    if (Array.isArray(splitter)) {
                        config.splitter = splitter;
                    }
                    if (Array.isArray(labels)) {
                        config.labels = labels;
                    }
                    if (Object.keys(config).length === 0) {
                        return msg;
                    }
                    node.client.request(node.id, "config", config);
                }
            } catch (error) {
                return msg;
            }
        });

        // if connect to preview, set preview to true
        node.wires.forEach((wires) => {
            wires.forEach((wire) => {
                RED.nodes.eachNode(function (n) {
                    if (n.id === wire && n.type === "preview" && !n.d) {
                        node.config.debug = true;
                    }
                });
            });
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

    RED.nodes.registerType("model", ModelNode);
};
