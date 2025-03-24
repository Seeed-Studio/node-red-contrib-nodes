const { YAW_ID, PITCH_ID, getMotorAngle, closeCanChannel } = require("../utils/motor_utils");

module.exports = function (RED) {
    function GetMotorAngleNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Flag to track if we're currently processing a command
        let waitingForAck = false;

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
                node.status({ fill: "blue", shape: "dot", text: "Reading" });

                // Determine motor type (yaw or pitch) based on configuration
                const output = config.output;
                const isYawMotor = output === "0";
                const motorId = isYawMotor ? YAW_ID : PITCH_ID;

                // Read current motor position using SocketCAN
                const rawAngle = await getMotorAngle(motorId);

                if (rawAngle === null) {
                    throw new Error("Failed to read motor angle");
                }

                // Format based on unit setting
                const unit = config.unit || "0";
                const useDecimal = unit === "0";
                
                // Calculate display angle (always in decimal for status)
                const displayAngle = Number((rawAngle / 100).toFixed(2));
                
                // Determine output value based on unit setting
                const outputAngle = useDecimal ? displayAngle : rawAngle;

                // Update status with current angle
                node.status({
                    fill: "green",
                    shape: "dot",
                    text: `${isYawMotor ? "Yaw" : "Pitch"}: ${displayAngle}°`,
                });

                // Send the angle to the output
                node.send({ payload: outputAngle });
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

    RED.nodes.registerType("get-motor-angle", GetMotorAngleNode);
};
