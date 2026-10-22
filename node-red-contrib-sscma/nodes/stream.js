module.exports = function (RED) {
    function StreamNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        node.client = RED.nodes.getNode(config.client);
        node.config = {
            protocol: config.protocol,
            port: +config.port,
            session: config.session,
            username: config.username,
            password: config.password,
            onvif: config.onvif ? true : false,
            onvif_port: config.onvif ? (config.onvif_port ? +config.onvif_port : 8899) : 0,
            audio: config.audio ? true : false,
        };
        node.message = function (msg) {};

        if (node.client) {
            node.client.register(node);
        }

        node.on("input", function (msg) {
            if (msg.hasOwnProperty("enabled")) {
                node.client.request(node.id, "enabled", msg.enabled);
            }
        });

        node.on("close", function (removed, done) {
            if (node.client) {
                node.client.deregister(node, done, removed);
                node.client = null;
            }
            done();
        });
    }

    RED.nodes.registerType("stream", StreamNode);
};
