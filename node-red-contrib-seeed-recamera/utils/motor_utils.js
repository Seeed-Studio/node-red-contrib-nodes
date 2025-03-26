// Only import required modules for SocketCAN
let socketcan = null;
try {
    socketcan = require("socketcan");
} catch (error) {
    console.warn("socketcan module not available, SocketCAN method will not work.");
}

// Motor constants
const YAW_ID = 0x141;    // Yaw motor ID in hex format
const PITCH_ID = 0x142;  // Pitch motor ID in hex format
const DEFAULT_SPEED = "5A.00";
const CURRENT_YAW_SPEED_KEY = "can$$currentYawSpeed";
const CURRENT_PITCH_SPEED_KEY = "can$$currentPitchSpeed";

// CAN bus name
const CAN_BUS = "can0";

// Byte masks for commands
const CMD_TYPE_A4 = 0xA4;  // Absolute position command
const CMD_TYPE_A6 = 0xA6;  // Legacy absolute position command
const CMD_TYPE_A8 = 0xA8;  // Relative offset command
const CMD_TYPE_94 = 0x94;  // Status query command

// SocketCAN channel management
let canChannel = null;
let currentCommand = null;
let currentMotorId = null;
let currentResolver = null;
let currentRejecter = null;
let commandTimeout = null;

// Command queue management
let commandQueue = [];
let isProcessingQueue = false;

/**
 * Converts decimal speed value to hex bytes
 * @param {Number} speed - Speed value (decimal)
 * @returns {Array} Array of bytes representing the speed [lowByte, highByte]
 */
function speedToBytes(speed) {
    speed = Math.abs(Math.floor(speed));
    speed = Math.min(speed, 65535);
    const hex = speed.toString(16).toUpperCase().padStart(4, "0");
    const lowByte = parseInt(hex.slice(2, 4), 16);
    const highByte = parseInt(hex.slice(0, 2), 16);

    return [lowByte, highByte];
}

/**
 * Legacy function - Converts decimal speed value to hex string
 * @param {Number} speed - Speed value (decimal)
 * @returns {String} Hex string in format "XX.XX"
 */
function speedToHexString(speed) {
    speed = Math.abs(Math.floor(speed));
    speed = Math.min(speed, 65535);
    const hex = speed.toString(16).toUpperCase().padStart(4, "0");
    const lowByte = hex.slice(2, 4);
    const highByte = hex.slice(0, 2);

    return `${lowByte}.${highByte}`;
}

/**
 * Converts hex bytes to speed value
 * @param {Array} bytes - Array of bytes [lowByte, highByte]
 * @returns {Number} Speed value (decimal)
 */
function bytesToSpeed(bytes) {
    if (!Array.isArray(bytes) || bytes.length !== 2) {
        return 0;
    }

    try {
        const lowByte = bytes[0];
        const highByte = bytes[1];
        return (highByte << 8) | lowByte;
    } catch (error) {
        return 0;
    }
}

/**
 * Legacy function - Converts hex string to speed value
 * @param {String} hexString - Hex string in format "XX.XX"
 * @returns {Number} Speed value (decimal)
 */
function hexToSpeed(hexString) {
    // Handle invalid input
    if (!hexString || typeof hexString !== "string") {
        return 0;
    }

    try {
        // Check if format is "XX.XX"
        const parts = hexString.split(".");
        if (parts.length !== 2 || parts[0].length !== 2 || parts[1].length !== 2) {
            return 0;
        }

        // Convert hex to decimal
        const lowByte = parseInt(parts[0], 16);
        const highByte = parseInt(parts[1], 16);

        // Return speed value
        return (highByte << 8) | lowByte;
    } catch (error) {
        return 0;
    }
}

/**
 * Converts decimal angle value to byte array (little-endian)
 * @param {Number} angle - Angle value (decimal)
 * @returns {Array} Array of 4 bytes
 */
function angleToBytes(angle) {
    const int32 = new Int32Array([angle])[0];
    const uint32 = new Uint32Array([int32])[0];
    const hex = uint32.toString(16).toUpperCase().padStart(8, "0");
    
    const byte1 = parseInt(hex.slice(6, 8), 16);
    const byte2 = parseInt(hex.slice(4, 6), 16);
    const byte3 = parseInt(hex.slice(2, 4), 16);
    const byte4 = parseInt(hex.slice(0, 2), 16);
    
    return [byte1, byte2, byte3, byte4];
}

/**
 * Converts byte array to angle value
 * @param {Array} bytes - Array of 4 bytes in little-endian order
 * @returns {Number} Angle value (decimal)
 */
function bytesToAngle(bytes) {
    try {
        if (!Array.isArray(bytes) || bytes.length !== 4) {
            throw new Error("Invalid byte array, expected 4 bytes");
        }

        // Convert bytes to hex (in little-endian order)
        const byte1 = bytes[0].toString(16).padStart(2, "0");
        const byte2 = bytes[1].toString(16).padStart(2, "0");
        const byte3 = bytes[2].toString(16).padStart(2, "0");
        const byte4 = bytes[3].toString(16).padStart(2, "0");

        // Convert to big-endian for calculation
        const hexValue = byte4 + byte3 + byte2 + byte1;
        const intValue = parseInt(hexValue, 16);

        // Handle negative values (two's complement)
        if ((intValue & 0x80000000) !== 0) {
            return intValue - 0x100000000;
        }
        
        return intValue;
    } catch (error) {
        console.error("Error converting bytes to angle:", error);
        return 0;
    }
}

/**
 * Converts degrees to motor units (hundredths of degrees)
 * @param {Number} angle - Angle value in degrees
 * @param {Boolean} isDegrees - Whether the input is in degrees (true) or already in motor units (false)
 * @returns {Number} Angle value in motor units (hundredths of degrees)
 */
function convertDegreesToMotorUnits(angle, isDegrees) {
    if (isDegrees) {
        return angle * 100; // Convert from degrees to motor units (hundredths of degrees)
    }
    return angle; // Already in motor units
}

/**
 * Converts motor units (hundredths of degrees) to degrees
 * @param {Number} motorUnits - Angle value in motor units (hundredths of degrees)
 * @param {Boolean} isDegrees - Whether to use degrees (true) or motor units (false)
 * @returns {Number} Angle value in degrees
 */
function convertMotorUnitsToDegrees(motorUnits, isDegrees) {
    if (isDegrees) {
        return Number((motorUnits / 100).toFixed(2)); // Convert from motor units to degrees
    }
    return motorUnits; // Already in degrees
}

/**
 * Creates a CAN command object for direct use with SocketCAN
 * @param {Number} motorId - Motor ID in hex format (e.g., 0x141)
 * @param {Array} data - Array of 8 bytes for the command
 * @returns {Object} CAN command object with id and data properties
 */
function createCanCommand(motorId, data) {
    // Ensure data is exactly 8 bytes (pad with zeros if needed)
    const fullData = Array(8).fill(0);
    data.forEach((byte, index) => {
        if (index < 8) fullData[index] = byte;
    });
    
    return {
        id: motorId,
        data: Buffer.from(fullData)
    };
}

/**
 * Creates an absolute position command (A4)
 * @param {Number} motorId - Motor ID in hex format (0x141 or 0x142)
 * @param {Number} speed - Speed value (0-255)
 * @param {Number} angle - Target angle in motor units (hundredths of degrees)
 * @returns {Object} CAN command object
 */
function createAbsolutePositionCommand(motorId, speed, angle) {
    const speedBytes = speedToBytes(speed);
    const angleBytes = angleToBytes(angle);
    const data = [
        CMD_TYPE_A4,    // Command type: A4 (absolute position)
        0x00,           // Direction: 00
        speedBytes[0],  // Speed low byte
        speedBytes[1],  // Speed high byte
        angleBytes[0],  // Angle byte 1 (LSB)
        angleBytes[1],  // Angle byte 2
        angleBytes[2],  // Angle byte 3
        angleBytes[3]   // Angle byte 4 (MSB)
    ];
    
    return createCanCommand(motorId, data);
}

/**
 * Creates a relative offset command (A8)
 * @param {Number} motorId - Motor ID in hex format (0x141 or 0x142)
 * @param {Number} speed - Speed value (0-255)
 * @param {Number} offset - Angle offset in motor units (hundredths of degrees)
 * @returns {Object} CAN command object
 */
function createRelativeOffsetCommand(motorId, speed, offset) {
    const speedBytes = speedToBytes(speed);
    const offsetBytes = angleToBytes(offset);
    
    const data = [
        CMD_TYPE_A8,    // Command type: A8 (relative offset)
        0x00,           // Direction: 00
        speedBytes[0],  // Speed low byte
        speedBytes[1],  // Speed high byte
        offsetBytes[0], // Offset byte 1 (LSB)
        offsetBytes[1], // Offset byte 2
        offsetBytes[2], // Offset byte 3
        offsetBytes[3]  // Offset byte 4 (MSB)
    ];
    
    return createCanCommand(motorId, data);
}

/**
 * Creates a status query command (94)
 * @param {Number} motorId - Motor ID in hex format (0x141 or 0x142)
 * @returns {Object} CAN command object
 */
function createStatusQueryCommand(motorId) {
    const data = [
        CMD_TYPE_94,  // Command type: 94 (status query)
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00  // All zeros
    ];
    
    return createCanCommand(motorId, data);
}

/**
 * Initializes a CAN channel
 * @param {string} interface - CAN interface name
 * @returns {Object} CAN channel object
 */
function initCanChannel(interface) {
    if (!canChannel) {
        try {
            if (!socketcan) {
                throw new Error("socketcan module not available");
            }
            canChannel = socketcan.createRawChannel(interface, true);

            // Add global message handler
            canChannel.addListener("onMessage", handleSocketCANMessage);
            canChannel.start();
        } catch (error) {
            console.error(`Error initializing SocketCAN channel:`, error);
            throw new Error(`Unable to initialize SocketCAN channel: ${error.message}`);
        }
    }
    return canChannel;
}

/**
 * Closes a CAN channel
 */
function closeCanChannel() {
    if (canChannel) {
        try {
            // Clean up current command state
            clearCommandState();

            canChannel.stop();
            canChannel = null;
        } catch (error) {
            console.error(`Error closing SocketCAN channel:`, error);
        }
    }
}

/**
 * Clear current command state
 */
function clearCommandState() {
    if (commandTimeout) {
        clearTimeout(commandTimeout);
        commandTimeout = null;
    }

    currentCommand = null;
    currentMotorId = null;
    currentResolver = null;
    currentRejecter = null;
}

/**
 * Process the next command in the queue
 */
async function processNextCommand() {
    // If already processing or queue is empty, return
    if (isProcessingQueue || commandQueue.length === 0 || currentCommand) {
        return;
    }

    // Set flag to indicate we're processing
    isProcessingQueue = true;

    try {
        // Get the next command from the queue
        const nextCmd = commandQueue.shift();
        const { motorId, commandData, timeout, resolve, reject } = nextCmd;

        // Execute the command
        await executeCommand(motorId, commandData, timeout, resolve, reject);
    } catch (error) {
        console.error("Error processing command queue:", error);
    } finally {
        // Reset processing flag
        isProcessingQueue = false;

        // Check if there are more commands to process
        if (commandQueue.length > 0 && !currentCommand) {
            // Process next command after a short delay to allow state reset
            setTimeout(processNextCommand, 50);
        }
    }
}

/**
 * Execute a specific CAN command
 * @param {Number} motorId - Motor ID in hex format (0x141 or 0x142)
 * @param {Array} commandData - Command data as byte array
 * @param {Number} timeout - Timeout in milliseconds
 * @param {Function} resolve - Promise resolve function
 * @param {Function} reject - Promise reject function
 */
async function executeCommand(motorId, commandData, timeout, resolve, reject) {
    if (!socketcan) {
        reject(new Error("socketcan module not available"));
        return;
    }

    // If another command is being processed, queue this one
    if (currentCommand) {
        reject(new Error("Internal error: Command state conflict"));
        return;
    }

    try {
        // Ensure CAN channel is initialized
        const channel = initCanChannel(CAN_BUS);

        // Prepare command data
        const commandBuffer = Buffer.from(commandData);

        // Set current command state
        currentCommand = commandData;
        currentMotorId = motorId;
        currentResolver = resolve;
        currentRejecter = reject;

        // Set timeout timer
        commandTimeout = setTimeout(() => {
            // Clean up state
            const resolver = currentResolver;
            clearCommandState();

            // Return timeout result
            resolver({
                success: false,
                error: "Timeout",
            });

            // Process next command if any
            processNextCommand();
        }, timeout);

        // Send command
        channel.send({
            id: motorId,
            data: commandBuffer,
            ext: false,
            rtr: false,
        });
    } catch (error) {
        // Clean up state
        clearCommandState();
        reject(new Error(`Failed to send command: ${error.message}`));

        // Process next command if any
        processNextCommand();
    }
}

/**
 * SocketCAN message handler
 * @param {Object} msg - SocketCAN message
 */
function handleSocketCANMessage(msg) {
    // If no pending command, return
    if (!currentCommand || !currentResolver || msg.id !== currentMotorId) {
        return;
    }

    // Print received data for debugging
    const dataHex = Buffer.from(msg.data)
        .toString("hex")
        .match(/.{1,2}/g)
        .join(".")
        .toLowerCase();

    // Check if this is a response to the current command
    // Convert current command to hex for comparison
    const cmdHex = Buffer.from(currentCommand).toString("hex").toLowerCase();
    const receivedHex = Buffer.from(msg.data).toString("hex").toLowerCase();
    
    if (receivedHex !== cmdHex) {
        // Not command echo
        // Parse angle - only for status query command responses
        let angle = null;
        if (currentCommand[0] === CMD_TYPE_94) {
            try {
                angle = parseAngle(msg.data);
            } catch (error) {
                console.warn(`Failed to parse response data: ${error.message}`);
            }
        }

        // Clear timeout timer
        if (commandTimeout) {
            clearTimeout(commandTimeout);
            commandTimeout = null;
        }

        // Call resolver and clear state
        const resolver = currentResolver;
        clearCommandState();

        resolver({
            success: true,
            data: msg.data,
            angle: angle,
        });

        // Process next command if any
        setTimeout(processNextCommand, 50);
    }
}

/**
 * Parse angle from SocketCAN response data
 * @param {Buffer} statusData - Status data
 * @returns {number} Parsed angle value
 */
function parseAngle(statusData) {
    if (!statusData || statusData.length < 6) {
        throw new Error("Invalid status data");
    }

    // Use bytes 4 and 5
    const lowByte = statusData[4];
    const highByte = statusData[5];

    // Combine to get angle value
    const angleValue = (highByte << 8) | lowByte;

    // Handle abnormal values
    if (angleValue > 35600) {
        return 0;
    }

    return angleValue;
}

/**
 * Send motor command using SocketCAN and wait for response
 * @param {Number} motorId - Motor ID in hex format (0x141 or 0x142)
 * @param {Array} commandData - Command data as byte array
 * @param {Number} timeout - Timeout in milliseconds
 * @returns {Promise<Object>} Response object
 */
async function sendCommand(motorId, commandData, timeout = 1000) {
    return new Promise((resolve, reject) => {
        // Add command to queue
        commandQueue.push({
            motorId,
            commandData,
            timeout,
            resolve,
            reject,
        });

        // Start processing the queue if not already processing
        if (!isProcessingQueue && !currentCommand) {
            processNextCommand();
        }
    });
}

/**
 * Set motor angle using SocketCAN with A4 command
 * @param {Number} motorId - Motor ID in hex format (0x141 or 0x142)
 * @param {Number} targetAngle - Target angle in motor units
 * @param {String|Array} speedHex - Speed as hex string or byte array
 * @param {Number} timeout - Timeout in milliseconds
 * @returns {Promise<Object>} Result object
 */
async function setMotorAngle(motorId, targetAngle, speedHex = DEFAULT_SPEED, timeout = 1000) {
    try {
        // Use the modern approach with createAbsolutePositionCommand
        const canCommand = createAbsolutePositionCommand(motorId, 
            typeof speedHex === 'string' ? hexToSpeed(speedHex) : 90, // Default to 90 if can't parse
            targetAngle);
        // Send the command directly
        const result = await sendCommand(motorId, canCommand.data, timeout);
        
        if (result.success) {
            return { success: true };
        } else {
            return { success: false, error: result.error || "Failed to send command" };
        }
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * Set motor offset using SocketCAN with A8 command
 * @param {Number} motorId - Motor ID in hex format (0x141 or 0x142)
 * @param {Number} offsetValue - Offset value in motor units
 * @param {String|Array} speedHex - Speed as hex string or byte array
 * @param {Number} timeout - Timeout in milliseconds
 * @returns {Promise<Object>} Result object
 */
async function setMotorOffset(motorId, offsetValue, speedHex = DEFAULT_SPEED, timeout = 1000) {
    try {
        // Use the modern approach with createRelativeOffsetCommand
        const canCommand = createRelativeOffsetCommand(motorId, 
            typeof speedHex === 'string' ? hexToSpeed(speedHex) : 90, // Default to 90 if can't parse
            offsetValue);
            
        // Send the command directly
        const result = await sendCommand(motorId, canCommand.data, timeout);
        
        if (result.success) {
            return { success: true };
        } else {
            return { success: false, error: result.error || "Failed to send command" };
        }
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * Get current motor angle using SocketCAN
 * @param {Number} motorId - Motor ID in hex format (0x141 or 0x142)
 * @param {Number} timeout - Timeout in milliseconds
 * @returns {Promise<Number|null>} Current angle or null
 */
async function getMotorAngle(motorId, timeout = 1000) {
    try {
        // Create status query command
        const canCommand = createStatusQueryCommand(motorId);
        
        // Send the command directly
        const result = await sendCommand(motorId, canCommand.data, timeout);
        
        if (result.success && result.angle !== null) {
            return result.angle;
        } else {
            return null;
        }
    } catch (error) {
        console.error("Error getting motor angle:", error);
        return null;
    }
}

module.exports = {
    // Constants
    YAW_ID,
    PITCH_ID,
    DEFAULT_SPEED,
    CURRENT_YAW_SPEED_KEY,
    CURRENT_PITCH_SPEED_KEY,
    CAN_BUS,
    CMD_TYPE_A4,
    CMD_TYPE_A6,
    CMD_TYPE_A8,
    CMD_TYPE_94,

    // Conversion utilities
    speedToBytes,
    bytesToSpeed,
    angleToBytes,
    bytesToAngle,
    convertDegreesToMotorUnits,
    convertMotorUnitsToDegrees,

    // Legacy functions - maintained for compatibility
    speedToHexString,
    hexToSpeed,

    // SocketCAN functions
    initCanChannel,
    closeCanChannel,
    sendCommand,
    setMotorAngle,
    setMotorOffset,
    getMotorAngle,

    // Command creation functions
    createCanCommand,
    createAbsolutePositionCommand,
    createRelativeOffsetCommand,
    createStatusQueryCommand,
};
