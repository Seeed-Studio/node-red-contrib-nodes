const { sendMotorCommand, checkCanPayloadInput, closeCanChannel } = require("../utils/can_utils");

module.exports = function (RED) {
    function CanWriteNode(config) {
        RED.nodes.createNode(this, config);
        const client = RED.nodes.getNode(config.client);
        const node = this;

        // Flag to track if we're waiting for a response
        let waitingForResponse = false;

        // Handle input messages
        node.on("input", function (msg) {
            // If already waiting for a response, send busy message to error output
            if (waitingForResponse) {
                node.status({ fill: "yellow", shape: "ring", text: "Busy" });
                // 发送错误消息到错误输出，这样流可以处理忙碌状态
                node.error("Node is busy processing another command", msg);
                return;
            }

            try {
                // Get CAN interface
                const canInterface = client.can.interface;
                if (!canInterface) {
                    throw new Error("CAN interface not configured");
                }

                let id, data;
                
                // 支持三种输入格式：字符串、标准对象或angle_to_can格式对象
                if (typeof msg.payload === 'string') {
                    // 处理字符串格式: "141#c1.0a.64.00.00.00.00.00"
                    const parts = msg.payload.split('#');
                    if (parts.length !== 2) {
                        throw new Error("Invalid string format. Expected: ID#DATA (e.g. 141#c1.0a.64.00.00.00.00.00)");
                    }
                    
                    // 提取ID，转换为数字
                    id = parseInt(parts[0].trim(), 16);
                    if (isNaN(id)) {
                        throw new Error(`Invalid ID: ${parts[0]}`);
                    }
                    
                    // 提取数据，转换为数组
                    const items = parts[1].split('.').map(item => item.trim());
                    if (items.length !== 8) {
                        throw new Error("Data must contain exactly 8 bytes");
                    }
                    
                    // 验证每个字节并转换为数字数组
                    data = [];
                    for (let i = 0; i < items.length; i++) {
                        const byte = parseInt(items[i], 16);
                        if (isNaN(byte) || byte < 0 || byte > 255) {
                            throw new Error(`Invalid byte at position ${i+1}: ${items[i]}`);
                        }
                        data.push(byte);
                    }
                } else if (msg.payload && typeof msg.payload === 'object') {
                    if (msg.payload.id !== undefined && msg.payload.data !== undefined) {
                        // 处理带有 id 和 data 属性的对象格式
                        
                        // 处理 ID
                        if (typeof msg.payload.id === 'number') {
                            // 如果 ID 已经是数字，直接使用
                            id = msg.payload.id;
                        } else if (typeof msg.payload.id === 'string') {
                            // 如果 ID 是字符串，转换为数字
                            id = parseInt(msg.payload.id, 16);
                            if (isNaN(id)) {
                                throw new Error(`Invalid ID: ${msg.payload.id}`);
                            }
                        } else {
                            throw new Error("ID must be a number or string");
                        }
                        
                        // 处理 data
                        if (Buffer.isBuffer(msg.payload.data)) {
                            // 如果 data 是 Buffer，直接转换为数组
                            data = Array.from(msg.payload.data);
                        } else if (Array.isArray(msg.payload.data)) {
                            // 如果 data 是数组，检查元素类型
                            data = [];
                            for (let i = 0; i < msg.payload.data.length; i++) {
                                const item = msg.payload.data[i];
                                if (typeof item === 'number') {
                                    // 如果是数字，直接使用
                                    data.push(item);
                                } else if (typeof item === 'string') {
                                    // 如果是字符串，转换为数字
                                    const byte = parseInt(item, 16);
                                    if (isNaN(byte) || byte < 0 || byte > 255) {
                                        throw new Error(`Invalid byte at position ${i+1}: ${item}`);
                                    }
                                    data.push(byte);
                                } else {
                                    throw new Error(`Invalid data type at position ${i+1}`);
                                }
                            }
                        } else {
                            throw new Error("Data must be a Buffer or Array");
                        }
                        
                        // 验证数据长度
                        if (data.length !== 8) {
                            throw new Error("Data must contain exactly 8 bytes");
                        }
                    } else {
                        // 尝试使用传统的验证方式（已弃用但保留兼容性）
                        try {
                            const validated = checkCanPayloadInput(msg.payload);
                            id = validated.id; // 现在 id 已经是数字类型
                            data = validated.data; // 现在 data 已经是数字数组
                        } catch (error) {
                            throw new Error(`Invalid payload format: ${error.message}`);
                        }
                    }
                } else {
                    throw new Error("Payload must be a string or object format");
                }

                // 确保ID和data都是正确的类型和格式
                if (typeof id !== 'number' || isNaN(id)) {
                    throw new Error("ID must be a valid number");
                }
                
                if (!Array.isArray(data) || data.length !== 8) {
                    throw new Error("Data must be an array of 8 bytes");
                }
                
                // 确保所有数据都是0-255之间的数字
                for (let i = 0; i < data.length; i++) {
                    if (typeof data[i] !== 'number' || data[i] < 0 || data[i] > 255) {
                        throw new Error(`Invalid byte at position ${i+1}`);
                    }
                }

                // 显示处理信息（用于节点状态显示）
                const idHex = id.toString(16).toUpperCase();
                
                // Set status to "Processing"
                waitingForResponse = true;
                node.status({ fill: "blue", shape: "dot", text: "Processing" });

                // 直接传递ID（数字）和data（字节数组）给sendMotorCommand
                sendMotorCommand(canInterface, id, data)
                    .then((responseData) => {
                        // Convert hex string array back to numeric byte array
                        const responseBytes = responseData.map(hex => parseInt(hex, 16));
                        
                        // Generate standard format string output (for backward compatibility)
                        const canMessage = `${idHex}#${responseData.join('.')}`;
                    
                        // Send unified response with both formats
                        node.send({
                            payload: {
                                id: id,              // Numeric ID
                                data: responseBytes  // Raw byte array
                            },
                        });

                        // Update node status
                        node.status({
                            fill: "green",
                            shape: "dot",
                            text: canMessage
                        });
                    })
                    .catch((error) => {
                        // 处理系统繁忙错误
                        const isBusy = error.message.includes('BUSY');
                        const statusText = isBusy ? "System Busy" : (error.message || "Error");
                        
                        // Handle errors
                        node.error(`Error: ${error.message}`, msg);
                        node.status({
                            fill: "red",
                            shape: "ring",
                            text: statusText
                        });
                    })
                    .finally(() => {
                        // Reset waiting state regardless of success or failure
                        waitingForResponse = false;
                    });
            } catch (error) {
                // 处理输入验证或其他错误
                const isBusy = error.message.includes('BUSY');
                const statusText = isBusy ? "System Busy" : (error.message || "Error");
                
                // Handle input validation errors
                node.error(`Error: ${error.message}`, msg);
                node.status({
                    fill: "red",
                    shape: "ring",
                    text: statusText
                });

                waitingForResponse = false;
            }
        });

        // Clean up resources when node is closed
        node.on("close", function() {
            try {
                closeCanChannel();
            } catch (error) {
                // Ignore close errors
            }
        });
    }

    RED.nodes.registerType("can-write", CanWriteNode);
};