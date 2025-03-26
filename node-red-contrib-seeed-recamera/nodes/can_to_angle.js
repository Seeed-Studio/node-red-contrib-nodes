const { YAW_ID, PITCH_ID, bytesToAngle, convertMotorUnitsToDegrees, CMD_TYPE_A4, CMD_TYPE_A6, CMD_TYPE_A8, CMD_TYPE_94 } = require("../utils/motor_utils");

module.exports = function (RED) {
    function CanToAngleNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        
        // Save the input configuration
        node.input = config.input || "payload";
        node.inputType = config["input-type"] || "msg";

        /**
         * Determines if a command is valid data command (not an ACK response)
         * @param {Number} commandType - The command type byte
         * @param {Array} data - The command data array
         * @returns {Boolean} Whether it's a valid command
         */
        function isValidCommandData(commandType, data) {
            if (!data || data.length < 2) return false;
            
            const secondByte = data[1];
            
            // 94 command (status query) - Valid response unless all remaining bytes are 0
            if (commandType === CMD_TYPE_94) {
                // Check if all remaining bytes are 0
                const allZero = data.slice(1).every(byte => byte === 0);
                return !allZero; // If not all zeros, it's a valid response
            }
            
            // A4/A6 commands (absolute position) - Second byte must be 00 or 01
            if (commandType === CMD_TYPE_A4 || commandType === CMD_TYPE_A6) {
                return secondByte === 0x00 || secondByte === 0x01;
            }
            
            // A8 command (relative offset) - Second byte must be 00
            if (commandType === CMD_TYPE_A8) {
                return secondByte === 0x00;
            }
            
            // Other command types are valid by default
            return true;
        }

        node.on("input", function (msg) {
            try {
                // Get input CAN message from configured property
                const inputSources = {
                    msg: () => RED.util.getMessageProperty(msg, node.input),
                    flow: () => node.context().flow.get(node.input),
                    global: () => node.context().global.get(node.input),
                };
                const canMsg = inputSources[node.inputType]?.();

                // Validate input
                if (!canMsg || typeof canMsg !== "object" || !canMsg.id || !canMsg.data) {
                    throw new Error("Input must be a valid CAN message object with id and data properties");
                }

                // Extract motor ID and data
                const motorId = canMsg.id;
                const data = Array.from(canMsg.data);
                
                // Validate motor ID
                if (motorId !== YAW_ID && motorId !== PITCH_ID) {
                    throw new Error(`Unknown motor ID: 0x${motorId.toString(16).toUpperCase()}`);
                }

                // Validate data length
                if (data.length < 1) {
                    throw new Error("Invalid data format: Empty data array");
                }

                // Extract command type from first byte
                const commandType = data[0];
                
                // Validate if it's a valid data command (not an ACK response)
                if (!isValidCommandData(commandType, data)) {
                    return; // Ignore ACK responses or invalid commands
                }

                // Process output format based on unit setting
                const unit = config.unit || "0";
                const isDegrees = unit === "0";
                
                // Create output object based on command type
                let output;
                
                // Status query command response (94)
                if (commandType === CMD_TYPE_94) {
                    // For status query, extract angle from response data if available
                    let angleValue = 0;
                    
                    // If command data has bytes 4 and 5, these contain the angle
                    if (data.length >= 6) {
                        // Extract the angle from bytes 4 and 5
                        const lowByte = data[4];
                        const highByte = data[5];
                        
                        // Combine to get angle value
                        angleValue = (highByte << 8) | lowByte;
                        
                        // Convert to decimal degrees if configured to do so
                        angleValue = convertMotorUnitsToDegrees(angleValue, isDegrees);
                    }
                    
                    output = {
                        motorId,
                        angle: angleValue
                    };
                    
                    node.status({
                        fill: "green",
                        shape: "dot",
                        text: `Status: ${angleValue}${isDegrees ? "°" : ""}`,
                    });
                } 
                // Absolute angle command (A4 or A6)
                else if (commandType === CMD_TYPE_A4 || commandType === CMD_TYPE_A6) {
                    // Extract angle bytes (last 4 bytes)
                    const angleBytes = data.slice(4, 8);
                    
                    // Convert bytes to angle value
                    let angleValue = bytesToAngle(angleBytes);
                    
                    // Convert to decimal degrees if configured to do so
                    angleValue = convertMotorUnitsToDegrees(angleValue, isDegrees);
                    
                    output = {
                        motorId,
                        angle: angleValue,
                    };

                    node.status({
                        fill: "green",
                        shape: "dot",
                        text: `Absolute: ${angleValue}${isDegrees ? "°" : ""}`,
                    });
                } 
                // Relative offset command (A8)
                else if (commandType === CMD_TYPE_A8) {
                    // Extract angle bytes (last 4 bytes)
                    const offsetBytes = data.slice(4, 8);
                    
                    // Convert bytes to angle value
                    let offsetValue = bytesToAngle(offsetBytes);
                    
                    // Convert to decimal degrees if configured to do so
                    offsetValue = convertMotorUnitsToDegrees(offsetValue, isDegrees);
                    
                    output = {
                        motorId,
                        offset: offsetValue,
                    };

                    // Update status with offset info
                    const sign = offsetValue > 0 ? "+" : "";
                    node.status({
                        fill: "green",
                        shape: "dot",
                        text: `Offset: ${sign}${offsetValue}${isDegrees ? "°" : ""}`,
                    });
                } else {
                    // throw new Error(`Unknown command type: 0x${commandType.toString(16).toUpperCase()}`);
                }

                // Send decoded output
                if (output) {
                    node.send({ payload: output });
                }
            } catch (error) {
                // Handle errors
                node.error(`Error decoding motor command: ${error.message}`);
                node.status({
                    fill: "red",
                    shape: "ring",
                    text: error.message || "Error",
                });
            }
        });
    }

    RED.nodes.registerType("can-to-angle", CanToAngleNode);
}; 