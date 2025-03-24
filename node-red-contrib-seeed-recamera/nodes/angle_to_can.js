const {
    YAW_ID,
    PITCH_ID,
    DEFAULT_SPEED,
    YAW_MIN_VALUE,
    YAW_MAX_VALUE,
    PITCH_MIN_VALUE,
    PITCH_MAX_VALUE,
    CURRENT_YAW_SPEED_KEY,
    CURRENT_PITCH_SPEED_KEY,
    angleToHexString,
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

                // Process input value based on unit setting
                let angleValue = numInputValue;
                const unit = config.unit || "0";
                const useDecimal = unit === "0";
                
                // Convert decimal to motor units if decimal input
                if (useDecimal) {
                    angleValue = angleValue * 100; // Convert decimal degrees to motor units
                }

                let outputCommand;

                if (isAbsolute) {
                    // Absolute angle mode (A6 command)
                    let targetAngle = angleValue;

                    // Apply angle limits based on motor type
                    if (motorId === YAW_ID) {
                        targetAngle = Math.max(YAW_MIN_VALUE, Math.min(YAW_MAX_VALUE, targetAngle));
                    } else {
                        targetAngle = Math.max(PITCH_MIN_VALUE, Math.min(PITCH_MAX_VALUE, targetAngle));
                    }

                    // Generate absolute position command (A6)
                    // Direction is determined by the motor controller
                    const angleHex = angleToHexString(targetAngle);
                    outputCommand = `${motorId}#A6.00.${speedHex}.${angleHex}`;
                } else {
                    // Relative offset mode (A8 command)
                    const offsetHex = angleToHexString(angleValue);
                    outputCommand = `${motorId}#A8.00.${speedHex}.${offsetHex}`;
                }

                node.status({
                    fill: "green",
                    shape: "dot",
                    text: outputCommand,
                });

                // Send the command to output
                node.send({ payload: outputCommand });
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