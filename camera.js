module.exports = function (RED) {
    'use strict';

    function CameraNode(n) {
        RED.nodes.createNode(this, n);
        const node = this;
        node.client = RED.nodes.getNode(n.client);
        node.config = {
            channels: n.channels,
        };

        console.log("config", JSON.stringify(node.config));

        node.receive = function (msg) {
            console.log("msg", JSON.stringify(msg));
        }

        if (node.client) {
            node.client.register(node);
        }

        node.on('close', function (removed, done) {
            if (node.client) {
                node.client.deregister(node, done, removed);
            } else {
                done();
            }
        });

    }

    RED.nodes.registerType("camera", CameraNode);
}
