const { initCanChannel, addMessageHandler, removeMessageHandler } = require('../utils/can_utils');

module.exports = function(RED) {
    function CanReadNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const client = RED.nodes.getNode(config.client);
        
        // Node internal variables
        let canChannel = null;
        let isListening = false;
        let handlerId = -1;
        
        // Get filter settings
        const commandFilter = config.filter || "none";
        
        /**
         * Process received CAN messages
         * @param {Object} msg - SocketCAN message
         */
        function handleCanMessage(msg) {
            try {
                // Get raw byte data as numeric array
                const dataBytes = Array.from(msg.data);
                
                // Convert to hex strings for display and legacy format
                const dataHex = dataBytes.map(b => b.toString(16).padStart(2, '0').toUpperCase());
                
                // Get numeric ID
                const id = msg.id;
                
                // Format ID as hex string for display
                const idHex = id.toString(16).toUpperCase();
                
                // Generate standard format ID#DATA for display and backward compatibility
                const canMessage = `${idHex}#${dataHex.join('.')}`;
                
                // Check command type filter
                if (commandFilter !== "none" && dataBytes.length > 0) {
                    // Get first byte as command type
                    const commandType = dataHex[0];
                    
                    // Skip the message if it doesn't match the filter
                    if (commandType !== commandFilter) {
                        // Update node status to show filter information
                        node.status({
                            fill: "blue",
                            shape: "dot", 
                            text: `Filtered: ${commandType} (not ${commandFilter})`
                        });
                        return; // Skip non-matching messages
                    }
                }
                
                // Create output message with both numeric and string formats
                const output = {
                    payload: {
                        id: id,               // Numeric ID
                        data: dataBytes       // Raw byte array
                    },
                };
                
                // Send message to Node-RED flow
                node.send(output);
                
                // Update node status - show most recently received message
                node.status({ 
                    fill: "green", 
                    shape: "dot", 
                    text: canMessage
                });
            } catch (error) {
                node.error(`Error processing CAN message: ${error.message}`);
                node.status({ 
                    fill: "red", 
                    shape: "ring", 
                    text: `Error: ${error.message}` 
                });
            }
        }
        
        /**
         * Start CAN listener
         */
        function startListener() {
            if (isListening) return;
            
            try {
                // Get CAN interface
                const canInterface = client.can.interface;
                if (!canInterface) {
                    throw new Error("CAN interface not configured");
                }
                
                // Get shared CAN channel
                canChannel = initCanChannel(canInterface);
                
                // Register our message handler
                handlerId = addMessageHandler(handleCanMessage);
                
                isListening = true;
                node.log(`Started listening on CAN interface ${canInterface} (using shared channel, handler ID: ${handlerId})`);
                node.status({ fill: "green", shape: "ring", text: "Listening" });
            } catch (error) {
                node.error(`Failed to start CAN listener: ${error.message}`);
                node.status({ fill: "red", shape: "ring", text: "Failed to start" });
            }
        }
        
        /**
         * Stop CAN listener
         */
        function stopListener() {
            if (!isListening || handlerId < 0) return;
            
            try {
                // Remove our message handler
                removeMessageHandler(handlerId);
                handlerId = -1;
                canChannel = null;
                isListening = false;
                
                node.log("Stopped CAN listener (shared channel remains active)");
                node.status({ fill: "grey", shape: "ring", text: "Stopped" });
            } catch (error) {
                node.error(`Error stopping CAN listener: ${error.message}`);
            }
        }
        
        // Automatically start listener when node is deployed
        startListener();
        
        // Cleanup: stop listener when node is removed
        node.on('close', function() {
            stopListener();
        });
    }
    
    RED.nodes.registerType("can-read", CanReadNode);
}; 