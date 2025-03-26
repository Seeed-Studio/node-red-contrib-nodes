const {
    YAW_ID,
    PITCH_ID,
    DEFAULT_SPEED,
    CURRENT_YAW_SPEED_KEY,
    CURRENT_PITCH_SPEED_KEY,
    speedToHexString,
    convertDegreesToMotorUnits,
    setMotorAngle,
    setMotorOffset,
    closeCanChannel,
} = require("../utils/motor_utils");

module.exports = function (RED) {
    function SetMotorAngleNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const globalContext = node.context().global;

        // Flag to track if we're currently processing a command
        let waitingForAck = false;

        /**
         * Process single motor movement
         * @param {Number} motorId - Motor ID in hex format (0x141 or 0x142)
         * @param {Number} angleValue - Angle value in motor units
         * @param {Boolean} isAbsolute - Whether this is absolute positioning
         * @param {String|Number} speedHex - Motor speed in hex string or number
         * @returns {Promise<void>}
         */
        async function processSingleMotor(motorId, angleValue, isAbsolute, speedHex) {
            if (isAbsolute) {
                // Absolute angle mode - A4 command
                const result = await setMotorAngle(motorId, angleValue, speedHex, 1000, node);

                if (!result.success) {
                    throw new Error(`Failed to set ${motorId === YAW_ID ? "yaw" : "pitch"} angle: ${result.error}`);
                }
            } else {
                // Relative offset mode - A8 command
                const result = await setMotorOffset(motorId, angleValue, speedHex);

                if (!result.success) {
                    throw new Error(`Failed to set ${motorId === YAW_ID ? "yaw" : "pitch"} offset: ${result.error}`);
                }
            }
        }

        /**
         * Process motor movement request using SocketCAN library
         * @param {Object} msg - Input message
         * @returns {Promise<void>}
         */
        async function processCommand(msg) {
            try {
                // Set processing status
                node.status({ fill: "blue", shape: "dot", text: "Processing" });

                // Get input value from configured source
                const inputSources = {
                    msg: () => RED.util.getMessageProperty(msg, config.input),
                    flow: () => node.context().flow.get(config.input),
                    global: () => node.context().global.get(config.input),
                };
                const inputValue = inputSources[config["input-type"]]?.();
                if (inputValue === undefined || inputValue === null) {
                    throw new Error("Input value is empty");
                }

                const output = config.output;
                const unit = config.unit || "0";
                const isDegrees = unit === "0";
                // Check if this is dual axis mode
                const isDualAxis = output === "4" || output === "5";
                const isAbsolute = output === "0" || output === "2" || output === "4";

                // Process based on selected mode
                if (isDualAxis) {
                    // Dual axis mode - expect JSON object input
                    if (typeof inputValue !== "object") {
                        throw new Error("Dual axis mode requires JSON object input");
                    }

                    // Validate required fields
                    if (inputValue.yaw_angle === undefined || inputValue.pitch_angle === undefined) {
                        throw new Error("Missing required fields: yaw_angle and/or pitch_angle");
                    }

                    // Set speeds if provided
                    if (inputValue.yaw_speed !== undefined && !isNaN(Number(inputValue.yaw_speed))) {
                        const yawSpeedHex = speedToHexString(Number(inputValue.yaw_speed));
                        globalContext.set(CURRENT_YAW_SPEED_KEY, yawSpeedHex);
                    }

                    if (inputValue.pitch_speed !== undefined && !isNaN(Number(inputValue.pitch_speed))) {
                        const pitchSpeedHex = speedToHexString(Number(inputValue.pitch_speed));
                        globalContext.set(CURRENT_PITCH_SPEED_KEY, pitchSpeedHex);
                    }

                    // Get current speeds from global context
                    const yawSpeedHex = globalContext.get(CURRENT_YAW_SPEED_KEY) || DEFAULT_SPEED;
                    const pitchSpeedHex = globalContext.get(CURRENT_PITCH_SPEED_KEY) || DEFAULT_SPEED;

                    // Convert angle values based on unit setting
                    const yawAngle = convertDegreesToMotorUnits(Number(inputValue.yaw_angle), isDegrees);
                    const pitchAngle = convertDegreesToMotorUnits(Number(inputValue.pitch_angle), isDegrees);

                    // Process yaw and pitch motors
                    await processSingleMotor(YAW_ID, yawAngle, isAbsolute, yawSpeedHex);
                    await processSingleMotor(PITCH_ID, pitchAngle, isAbsolute, pitchSpeedHex);

                    // 成功后更新状态
                    if (isAbsolute) {
                        node.status({
                            fill: "green",
                            shape: "dot",
                            text: `Set Yaw: ${inputValue.yaw_angle}°, Pitch: ${inputValue.pitch_angle}°`,
                        });
                    } else {
                        node.status({
                            fill: "green",
                            shape: "dot",
                            text: `Offset Yaw: ${inputValue.yaw_angle}°, Pitch: ${inputValue.pitch_angle}°`,
                        });
                    }
                } else {
                    // Single axis mode
                    // Process single value input
                    const numInputValue = Number(inputValue);
                    if (isNaN(numInputValue)) {
                        throw new Error("Input value is not a number");
                    }

                    // Determine motor type (yaw or pitch)
                    const isYawMotor = output === "0" || output === "1";
                    const motorId = isYawMotor ? YAW_ID : PITCH_ID;
                    const motorName = isYawMotor ? "Yaw" : "Pitch";
                    const modeType = isAbsolute ? "Set" : "Offset";

                    // Convert input value to motor angle units
                    const angleValue = convertDegreesToMotorUnits(numInputValue, isDegrees);

                    // For relative mode with zero offset, return immediately
                    if (!isAbsolute && angleValue === 0) {
                        node.status({ fill: "green", shape: "dot", text: "Ready (no change)" });
                        return;
                    }

                    // Get motor speed from global context or use default
                    const speedHex = globalContext.get(isYawMotor ? CURRENT_YAW_SPEED_KEY : CURRENT_PITCH_SPEED_KEY) ?? DEFAULT_SPEED;

                    // Process the motor command
                    await processSingleMotor(motorId, angleValue, isAbsolute, speedHex);

                    // Update status
                    node.status({
                        fill: "green",
                        shape: "dot",
                        text: `${modeType} ${motorName}: ${numInputValue}°`,
                    });
                }
            } catch (error) {
                node.status({ fill: "red", shape: "ring", text: error.message || "Error" });
                throw error;
            }
        }

        // Handle input messages
        node.on("input", async function (msg) {
            // If already processing, discard message
            if (waitingForAck) {
                node.status({ fill: "yellow", shape: "ring", text: "Busy" });
                return;
            }

            try {
                // Set processing flag before async operation
                waitingForAck = true;

                // Process command using SocketCAN
                await processCommand(msg);

                // 此节点不发送输出
            } catch (error) {
                node.error(`Error: ${error.message}`);
                node.status({
                    fill: "red",
                    shape: "ring",
                    text: error.message || "Error",
                });
            } finally {
                // Ensure processing flag is reset in all cases
                waitingForAck = false;
            }
        });

        node.on("close", function () {
            // Clean up resources when node is closed
            try {
                closeCanChannel();
            } catch (error) {
                // Ignore close errors
            }
        });
    }

    RED.nodes.registerType("set-motor-angle", SetMotorAngleNode);
};
