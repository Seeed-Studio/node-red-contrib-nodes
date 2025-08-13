module.exports = function (RED) {
    function QRCodeNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // 获取客户端节点（负责与 reCamera 后端通信）
        node.client = RED.nodes.getNode(config.client);

        // 无配置项
        node.config = {};

        node.on("input", function (msg) {
            try {
                // 如果是控制消息（如启用/禁用），忽略或透传
                if (msg.hasOwnProperty("enabled")) {
                    node.client.request(node.id, "enabled", msg.enabled);
                } 
            } catch (error) {
                node.error("QRCode node error: " + error.message, msg);
            }
        });

        // 注册到 client，用于接收状态更新或响应
        if (node.client) {
            node.client.register(node);
        }

        // 清理
        node.on("close", function (removed, done) {
            if (node.client) {
                node.client.deregister(node, done, removed);
                node.client = null;
            } else {
                done();
            }
        });

        // 接收来自 client 的消息（可选：用于状态反馈）
        node.message = function (msg) {
            node.send(msg);
        };
    }

    RED.nodes.registerType("qrcode", QRCodeNode);
};