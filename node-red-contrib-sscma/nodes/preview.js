module.exports = function (RED) {
    const WebSocket = require("ws");
    const path = require("path");
    let routesRegistered = false;
    let activePreviewNodes = 0;

    // 单例 WS 服务与客户端集合
    let wss = null;
    const wsClients = new Set();
    const wsPort = 8090;

    function ensureWSServer() {
        if (wss) return;
        wss = new WebSocket.Server({ port: wsPort });
        wss.on("connection", function (ws) {
            wsClients.add(ws);
            ws.on("close", function () {
                wsClients.delete(ws);
            });
            ws.on("error", function () {
                try {
                    ws.close();
                } catch (e) {}
                wsClients.delete(ws);
            });
        });
    }

    function broadcastToClients(messageObj) {
        if (!wss) return;
        const data = JSON.stringify(messageObj);
        wsClients.forEach(function (ws) {
            if (ws.readyState === WebSocket.OPEN) {
                try {
                    ws.send(data);
                } catch (e) {}
            }
        });
    }

    function PreviewNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        this.active = config.active === null || typeof config.active === "undefined" || config.active;

        activePreviewNodes++;
        ensureWSServer();

        // WS 模式下不再需要存活超时逻辑

        node.on("input", function (msg) {
            if (this.active !== true) {
                return;
            }
            if (msg.payload.name === "invoke" || msg.payload.name === "sample") {
                broadcastToClients({ id: node.id, data: msg.payload.data });
                if (msg.payload.data.counts) {
                    const countA = msg.payload.data.counts[0];
                    const countB = msg.payload.data.counts[1];
                    const countBA = msg.payload.data.counts[2];
                    const countAB = msg.payload.data.counts[3];
                    const textContent = `A: ${countA} B: ${countB} A->B: ${countAB} B->A: ${countBA}`;
                    node.status({ fill: "blue", shape: "dot", text: textContent });
                }
            }
        });

        node.on("close", function () {
            // 可选：通知客户端该节点关闭
            broadcastToClients({ id: this.id });
            // 无需清理超时器

            activePreviewNodes--;

            node.status({});
        });
    }
    RED.nodes.registerType("preview", PreviewNode);

    // 提供前端可加载的 jmuxer.min.js 资源
    if (!routesRegistered) {
        try {
            RED.httpAdmin.get("/sscma/jmuxer.min.js", function (req, res) {
                res.sendFile(path.join(__dirname, "static", "jmuxer.min.js"));
            });
            routesRegistered = true;
        } catch (e) {}
    }
};
