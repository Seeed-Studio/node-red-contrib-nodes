module.exports = function (RED) {
    const path = require("path");
    let routesRegistered = false;

    function PreviewNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.on("close", function () {
            node.status({});
        });
    }
    RED.nodes.registerType("preview", PreviewNode);

    // Serve the jmuxer.min.js file
    if (!routesRegistered) {
        try {
            RED.httpAdmin.get("/sscma/jmuxer.min.js", function (req, res) {
                res.sendFile(path.join(__dirname, "static", "jmuxer.min.js"));
            });
            routesRegistered = true;
        } catch (e) {}
    }
};
