const {
    YAW_ID,
    PITCH_ID,
    DEFAULT_SPEED,
    CURRENT_YAW_SPEED_KEY,
    CURRENT_PITCH_SPEED_KEY,
    hexToSpeed,
    createAbsolutePositionCommand,
    createRelativeOffsetCommand,
} = require("../utils/motor_utils");

module.exports = function (RED) {
    function AngleToCanNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const globalContext = node.context().global;

        node.on("input", async function (msg) {
            try {
                // Get input value from configured source (msg, flow, or global)
                const inputSources = {
                    msg: () => RED.util.getMessageProperty(msg, config.input),
                    flow: () => node.context().flow.get(config.input),
                    global: () => node.context().global.get(config.input),
                };
                const inputValue = inputSources[config["input-type"]]?.();

                // Validate input value
                if (inputValue === undefined || inputValue === null) {
                    throw new Error("Input value is empty");
                }

                // Convert input to number and validate
                const numInputValue = Number(inputValue);
                if (isNaN(numInputValue)) {
                    throw new Error("Input value is not a number");
                }

                // Get output configuration
                const output = config.output;

                // Determine motor type (yaw or pitch)
                const isYawMotor = output === "0" || output === "1";
                const motorId = isYawMotor ? YAW_ID : PITCH_ID;

                // Determine control mode (absolute or relative)
                const isAbsolute = output === "0" || output === "2";

                // Get current speed from global context or use default
                const speedHex = globalContext.get(isYawMotor ? CURRENT_YAW_SPEED_KEY : CURRENT_PITCH_SPEED_KEY) ?? DEFAULT_SPEED;
                // Convert speedHex to number
                const speedValue = hexToSpeed(speedHex);
                
                // Process input value based on unit setting
                let angleValue = numInputValue;
                const unit = config.unit || "0";
                const useDecimal = unit === "0";
                
                // Convert decimal to motor units if decimal input
                if (useDecimal) {
                    angleValue = angleValue * 100; // Convert decimal degrees to motor units
                }

                // Create the CAN command object
                let canCommand;

                if (isAbsolute) {
                    // Absolute angle mode
                    // Create the CAN command object using the utility function
                    canCommand = createAbsolutePositionCommand(motorId, speedValue, angleValue);
                    
                    // For status display only
                    const displayText = `A4: ${motorId.toString(16).toUpperCase()} ${(angleValue/100).toFixed(2)}°`;
                    node.status({
                        fill: "green",
                        shape: "dot",
                        text: displayText,
                    });
                } else {
                    // Relative offset mode
                    // Create the CAN command object using the utility function
                    canCommand = createRelativeOffsetCommand(motorId, speedValue, angleValue);
                    
                    // For status display only
                    const sign = angleValue >= 0 ? "+" : "";
                    const displayText = `A8: ${motorId.toString(16).toUpperCase()} ${sign}${(angleValue/100).toFixed(2)}°`;
                    node.status({
                        fill: "green",
                        shape: "dot",
                        text: displayText,
                    });
                }

                // Send the CAN command object to output
                msg.payload = canCommand;
                node.send(msg);
            } catch (error) {
                // Handle errors
                node.error(`Error encoding motor angle: ${error.message}`);
                node.status({
                    fill: "red",
                    shape: "ring",
                    text: error.message || "Error",
                });
            }
        });
    }

    RED.nodes.registerType("angle-to-can", AngleToCanNode);
}; 