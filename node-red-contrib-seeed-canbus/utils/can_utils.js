const { exec } = require("child_process");
const util = require("util");

// Add socketcan module import
let socketcan = null;
try {
    socketcan = require("socketcan");
} catch (error) {
    console.warn("socketcan module not available, SocketCAN method will not work.");
}

const execAsync = util.promisify(exec);

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

// Track received messages - 简化状态变量
let receivedMessage = null;

// 外部消息处理器列表
let externalMessageHandlers = [];

/**
 * 添加外部消息处理器
 * @param {Function} handler - 消息处理函数
 * @returns {number} 处理器ID，用于后续移除
 */
function addMessageHandler(handler) {
    if (typeof handler !== 'function') {
        throw new Error('Message handler must be a function');
    }
    externalMessageHandlers.push(handler);
    return externalMessageHandlers.length - 1; // 返回处理器ID
}

/**
 * 移除外部消息处理器
 * @param {number} handlerId - 处理器ID
 */
function removeMessageHandler(handlerId) {
    if (handlerId >= 0 && handlerId < externalMessageHandlers.length) {
        // 将处理器替换为null，而不是从数组中移除，以保持ID稳定
        externalMessageHandlers[handlerId] = null;
    }
}

/**
 * Initialize the SocketCAN channel
 * @param {string} canInterface - CAN bus interface name
 * @returns {Object} SocketCAN channel object
 */
function initCanChannel(canInterface) {
    if (!canChannel) {
        try {
            if (!socketcan) {
                throw new Error("socketcan module not available");
            }
            canChannel = socketcan.createRawChannel(canInterface, true);
            
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
 * Close the SocketCAN channel
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
    receivedMessage = null;
}

/**
 * Process the next command in the queue
 * This function handles the command queue processing and ensures proper command execution
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
        const { canInterface, motorId, commandData, timeout, resolve, reject } = nextCmd;

        // Execute the command - commandData 已经是字节数组格式
        await executeCommand(canInterface, motorId, commandData, timeout, resolve, reject);
    } catch (error) {
        console.error("Error processing command queue:", error);
    } finally {
        // Reset processing flag
        isProcessingQueue = false;

        // Process next command if any
        if (commandQueue.length > 0 && !currentCommand) {
            setTimeout(processNextCommand, 50);
        }
    }
}

/**
 * Execute a specific CAN command
 * @param {string} canInterface - CAN bus interface name
 * @param {Number} motorId - Motor ID in hex format (0x141 or 0x142)
 * @param {Array} commandData - Command data as byte array
 * @param {Number} timeout - Timeout in milliseconds
 * @param {Function} resolve - Promise resolve function
 * @param {Function} reject - Promise reject function
 */
async function executeCommand(canInterface, motorId, commandData, timeout, resolve, reject) {
    if (!socketcan) {
        reject(new Error("socketcan module not available"));
        return;
    }

    try {
        // 直接使用数字数组创建Buffer
        const commandBuffer = Buffer.from(commandData);
        
        // Ensure CAN channel is initialized
        const channel = initCanChannel(canInterface);
        
        // If a command is already being processed, reject with error
        if (currentCommand) {
            reject(new Error("Internal error: Command state conflict"));
            return;
        }
        
        // Set current command state
        clearCommandState(); // Clear any previous state
        currentCommand = commandData;
        currentMotorId = motorId;
        currentResolver = resolve;
        currentRejecter = reject;
        
        // Set timeout timer
        commandTimeout = setTimeout(() => {
            console.error(`Command timeout: Motor 0x${motorId.toString(16).toUpperCase()} not responding`);
            
            // 简化超时处理逻辑
            const resolver = currentResolver;
            clearCommandState();
            
            // 返回超时结果
            resolver({
                success: false,
                error: "Timeout"
            });
            
            // Process next command if any
            processNextCommand();
        }, timeout);
        
        // Send command
        channel.send({
            id: motorId,
            data: commandBuffer,
            ext: false,
            rtr: false
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
 * Process the response and resolve the promise
 */
function processResponse() {
    // If no message received or no resolver, return
    if (!receivedMessage || !currentResolver) {
        return;
    }
    
    // Clear timeout timer
    if (commandTimeout) {
        clearTimeout(commandTimeout);
        commandTimeout = null;
    }
        
    // 调用resolver并清理状态
    const resolver = currentResolver;
    const responseData = receivedMessage;
    clearCommandState();
    
    // 返回成功的结果
    resolver({
        success: true,
        data: responseData.data,
        rawHex: responseData.dataHex
    });
    
    // Process next command if any
    setTimeout(processNextCommand, 50);
}

/**
 * Handle incoming SocketCAN messages
 * @param {Object} msg - SocketCAN message object
 */
function handleSocketCANMessage(msg) {
    // If no pending command, return
    if (currentCommand && currentResolver && msg.id === currentMotorId) {
        // 获取接收到消息的字节数组
        const receivedData = Array.from(msg.data);
        
        // 检查是否是命令回显
        let isEcho = true;
        if (currentCommand.length === receivedData.length) {
            for (let i = 0; i < currentCommand.length; i++) {
                if (currentCommand[i] !== receivedData[i]) {
                    isEcho = false;
                    break;
                }
            }
        } else {
            isEcho = false;
        }
        
        // 如果收到的不是命令回显，则认为是响应
        if (!isEcho) {
            // 存储接收到的消息
            receivedMessage = {
                data: msg.data,
                dataHex: Buffer.from(msg.data).toString('hex')
            };
                    
            // 收到消息后立即处理响应
            processResponse();
        }
    }
    
    // 调用所有注册的外部消息处理器
    for (let i = 0; i < externalMessageHandlers.length; i++) {
        const handler = externalMessageHandlers[i];
        if (handler) {
            try {
                handler(msg);
            } catch (error) {
                console.error(`Error in external message handler ${i}: ${error.message}`);
            }
        }
    }
}

/**
 * Send CAN command using SocketCAN and wait for response
 * @param {string} canInterface - CAN bus interface name
 * @param {Number} motorId - Motor ID (decimal numeric value)
 * @param {Array<Number>} commandData - Command data byte array (numeric values)
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<Array>} Response data as hex string array
 */
async function sendMotorCommand(canInterface, motorId, commandData, timeout = 1000) {
    if (!socketcan) {
        throw new Error("socketcan module not available");
    }
    
    return new Promise((resolve, reject) => {
        // 确保 motorId 是数字类型
        if (typeof motorId !== 'number') {
            reject(new Error("Motor ID must be a number"));
            return;
        }
        
        // 确保 commandData 是数组类型
        if (!Array.isArray(commandData)) {
            reject(new Error("Command data must be an Array"));
            return;
        }
        
        // 验证每个字节是有效的数字
        for (let i = 0; i < commandData.length; i++) {
            if (typeof commandData[i] !== 'number' || commandData[i] < 0 || commandData[i] > 255) {
                reject(new Error(`Invalid byte in command data at position ${i}: ${commandData[i]}`));
                return;
            }
        }
        
        // Add command to queue
        commandQueue.push({
            canInterface,
            motorId,
            commandData, // 直接传递字节数组
            timeout,
            resolve: result => {
                if (result.success) {
                    // Process the data into the format expected by existing code
                    const responseData = [];
                    if (result.data) {
                        // Convert Buffer to Array of hex strings
                        for (let i = 0; i < result.data.length; i++) {
                            responseData.push(result.data[i].toString(16).padStart(2, '0').toUpperCase());
                        }
                    }
                    resolve(responseData);
                } else {
                    reject(new Error(result.error || "Unknown error"));
                }
            },
            reject
        });
        
        // Start processing the queue if not already processing
        if (!isProcessingQueue && !currentCommand) {
            processNextCommand();
        }
    });
}

/**
 * Validates and formats CAN payload input
 * @param {Object|String} input - Input data in either object format {id: string, data: string} or string format "ID#DATA"
 * @returns {Object} Object containing validated id (number) and data (array of numbers)
 * @throws {Error} If input format is invalid
 */
function checkCanPayloadInput(input) {
    let idStr, items;

    // 处理字符串格式输入: "141#c1.0a.64.00.00.00.00.00"
    if (typeof input === 'string') {
        const parts = input.split('#');
        if (parts.length !== 2) {
            throw new Error("Invalid string format. Expected: ID#DATA (e.g. 141#c1.0a.64.00.00.00.00.00)");
        }
        
        idStr = parts[0].trim();
        items = parts[1].split('.').map(item => item.trim());
        
        // 验证ID是否为有效的十六进制字符串
        if (!/^[0-9A-Fa-f]+$/.test(idStr)) {
            throw new Error(`CAN ID ${idStr} is not a valid hex value`);
        }
        
        // 验证数据部分
        if (items.length !== 8) {
            throw new Error("Data must contain exactly 8 bytes");
        }
    }
    // 处理对象格式输入: { id: "141", data: ["C1", "0A", ...] }
    else if (input && typeof input === "object") {
        idStr = input.id;
        items = input.data;

        if (!idStr || (typeof idStr !== "string" && typeof idStr !== "number")) {
            throw new Error("CAN ID must be a string or number");
        }

        if (!items || !Array.isArray(items)) {
            throw new Error("Data items must be an array");
        }
    }
    else {
        throw new Error("Payload must be an object or a string in format 'ID#DATA'");
    }

    // 验证数组长度
    if (items.length !== 8) {
        throw new Error("Data items must be exactly 8 bytes");
    }

    // 将ID转换为数字
    const id = (typeof idStr === 'number') ? idStr : parseInt(idStr, 16);
    if (isNaN(id)) {
        throw new Error(`Invalid CAN ID: ${idStr}`);
    }

    // 将数据项转换为数字数组
    const dataArray = [];
    for (let i = 0; i < items.length; i++) {
        let byteValue;
        
        if (typeof items[i] === 'number') {
            byteValue = items[i];
        } else if (typeof items[i] === 'string' && /^[0-9A-Fa-f]{1,2}$/.test(items[i])) {
            byteValue = parseInt(items[i], 16);
        } else {
            throw new Error(`Data byte at index ${i} (${items[i]}) is not a valid hex byte`);
        }
        
        if (byteValue < 0 || byteValue > 255) {
            throw new Error(`Data byte at index ${i} (${items[i]}) is out of range (0-255)`);
        }
        
        dataArray.push(byteValue);
    }

    return { id, data: dataArray };
}

/**
 * Get available CAN interfaces
 * @param {string} interfaceName - Base interface name to search for
 * @returns {Promise<Array<string>>} Array of interface names
 */
async function getCanInterfaces(interfaceName = "can") {
    try {
        const { stdout } = await execAsync("ip -d link show");
        const lines = stdout.split("\n");
        const interfaces = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith(interfaceName)) {
                const parts = line.split(":");
                if (parts.length > 1) {
                    interfaces.push(parts[1].trim());
                }
            }
        }

        return interfaces;
    } catch (error) {
        console.error(`Error getting CAN interfaces: ${error.message}`);
        return [];
    }
}

/**
 * Run a shell command
 * @param {string} command - Command to run
 * @returns {Promise<Object>} Command result
 */
async function runCommand(command) {
    try {
        const { stdout, stderr } = await execAsync(command);
        return {
            success: true,
            stdout,
            stderr,
        };
    } catch (error) {
        return {
            success: false,
            error: error.message,
        };
    }
}

module.exports = {
    sendMotorCommand,
    checkCanPayloadInput,
    getCanInterfaces,
    runCommand,
    initCanChannel,
    closeCanChannel,
    addMessageHandler,
    removeMessageHandler
};
