![Platform Node-RED](https://img.shields.io/badge/Platform-Node--RED-red.png)

## Overview
This Node-RED palette provides nodes for interacting with the Seeed Studio reCamera and reCamera Gimbal devices, allowing you to integrate hardware interface functionalities like light or motor control into your Node-RED flows.

## Installation

To install the package in Node-RED, run the following command:

```bash
npm install node-red-contrib-seeed-recamera
```

Alternatively, you can install it through the Node-RED palette manager by searching for "node-red-contrib-seeed-recamera".

## Categories

### reCamera Nodes
#### Light

This is the Light node for the build-in fill light on reCamera.

***Input***：Parse in `msg.payload = on` to start light, and `msg.payload = off` to stop light.

No output.

### reCamera Gimbal Nodes
#### Motor IDs for all nodes in this group:
- Yaw motor (horizontal): `0x141`
- Pitch motor (vertical): `0x142`
#### Angle to CAN
The node takes a numeric angle value as input and generates a CAN message object that can be sent directly to a CAN bus interface or to a CAN Write node.

***Input***: should be a numeric value representing the target angle (for absolute positioning) or angle offset (for relative movement).

***Outputs***: a CAN message object that can be sent directly to a CAN bus:

#### CAN to Angle
The node takes a CAN message object as input and extracts the motor ID, command type, and angle/offset value. It supports absolute position commands (A4), relative offset commands (A8), and status query commands (94).
***Input***: should be a CAN message object with the following structure:
```json
{
  "id": 0x141,  // Motor ID in hex format (0x141 for Yaw, 0x142 for Pitch)
  "data": [...]  // Byte array containing the command data (8 bytes)
}
```

***Outputs***: a JSON object with the decoded information:
```json
{
    "payload": {
        "motorId": ,
        "angle": 
    }
}
```

#### Get Motor Angle
The node queries the current position of either the yaw (horizontal) or pitch (vertical) motor and outputs the angle. This is useful for monitoring the current orientation of the camera or for implementing position-based logic in your flows.

***Input***: Any input message will trigger the node to read the current motor angle. The content of the input message is not used.

***Outputs***:The node outputs the current angle value in the `msg.payload` property:

```json
// With "Output in decimal" selected
{
    "payload": 90.5
}

// With "Output in integer" selected
{
    "payload": 9050
}
```
#### Set Motor Angle
This node configures and sends motor angle commands to the reCamera Gimbal motors using SocketCAN direct communication.

***Input***:

- For single-axis control, the input is a number representing the angle value.

- For dual-axis control, the input should be a JSON object with this structure:

    ```json
    {
        "yaw_angle": value,           // Horizontal angle in degrees
        "yaw_speed": speed_value,     // Optional: 0-720
        "pitch_angle": value,         // Vertical angle in degrees
        "pitch_speed": speed_value    // Optional: 0-720
    }
    ```

***Outputs***:
This node does not produce any output messages. It only sets the motor angle and updates its status display to reflect the operation result.

#### Set Motor Speed
The node sets the speed value for either the yaw (horizontal) or pitch (vertical) motor. This speed setting is stored in the global context and used by other motor control nodes when sending movement commands using SocketCAN.

***Input***:
The input should be a numeric value representing the desired motor speed. The value can be provided in the following formats:

-   Number: `90`
-   String containing a number: `"45"`
***Outputs***:
This node does not produce any output messages. It only updates the global context variables and updates its status display to reflect the operation result.

## License

This project is licensed under the Apache License 2.0. 