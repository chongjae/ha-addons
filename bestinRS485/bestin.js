/**
 * RS485 Homegateway for Bestin Homenet
 * @소스 공개 : Daehwan, Kang
 * @베스틴 홈넷용으로 수정 : harwin
 * @수정일 2022-12-14
 */

const util = require('util');
const net = require('net');
const SerialPort = require('serialport').SerialPort;
const mqtt = require('mqtt');

// 커스텀 파서
const Transform = require('stream').Transform;

const CONFIG = require('/data/options.json');  //**** 애드온의 옵션을 불러옵니다. 이후 CONFIG.mqtt.username 과 같이 사용가능합니다. 

// 각 디바이스 설정
const portVar = {
    // 타입 정의
    type: CONFIG.rs485.port_type, //'socket' , 'serial'
    //시리얼 설정
    windowPort: CONFIG.port.windowPort,
    rpiPort: CONFIG.port.rpiPort,
    // 소켓 설정
    port: CONFIG.port.port,
    addr: CONFIG.port.address
};
const energyVar = {
    // 타입 정의
    type: CONFIG.rs485.energy_type, //'socket' , 'serial'
    //시리얼 설정
    windowPort: CONFIG.energy.windowPort,
    rpiPort: CONFIG.energy.rpiPort,
    // 소켓 설정
    port: CONFIG.energy.port,
    addr: CONFIG.energy.address
};
const controlVar = {
    // 타입 정의
    type: CONFIG.rs485.ctrl_type, //'socket' , 'serial'
    // 시리얼 설정
    windowPort: CONFIG.control.windowPort,
    rpiPort: CONFIG.control.rpiPort,
    // 소켓 설정
    port: CONFIG.control.port,
    addr: CONFIG.control.address
};
const smartVar = {
    enable: CONFIG.rs485.ev_enable,
    recv_type: CONFIG.rs485.recv_type,
    send_type: CONFIG.rs485.send_type,

    recv_windowPort: CONFIG.smart.recv_windowPort,
    recv_rpiPort: CONFIG.smart.recv_rpiPort,
    send_windowPort: CONFIG.smart.send_windowPort,
    send_rpiPort: CONFIG.smart.send_rpiPort,

    recv_port: CONFIG.smart.recv_port,
    recv_addr: CONFIG.smart.recv_addr,
    send_port: CONFIG.smart.send_port,
    send_addr: CONFIG.smart.send_addr
};

// MQTT 설정
const mqttVar = {
    broker: CONFIG.mqtt.broker,
    port: CONFIG.mqtt.port,
    username: CONFIG.mqtt.username,
    password: CONFIG.mqtt.password,
    clientId: 'bestin_ipark',
    topic_prefix: CONFIG.mqtt.prefix,
    state_topic: CONFIG.mqtt.prefix + '/%s%s/%s/state',
    device_topic: CONFIG.mqtt.prefix + '/+/+/command'
};

const CONST = {
    // 포트이름 설정
    portName: process.platform.startsWith('win') ? portVar.windowPort : portVar.rpiPort,
    portEN: process.platform.startsWith('win') ? energyVar.windowPort : energyVar.rpiPort,
    portCTRL: process.platform.startsWith('win') ? controlVar.windowPort : controlVar.rpiPort,
    portRECV: process.platform.startsWith('win') ? smartVar.recv_windowPort : smartVar.recv_rpiPort,
    portSEND: process.platform.startsWith('win') ? smartVar.send_windowPort : smartVar.send_rpiPort,
    // 구/신버전 선택
    WALLPAD_TYPE: CONFIG.rs485.wallpad_type, //2013-2015년 이후 아파트(old), 2016-2018년 이후 아파트(new)
    // SerialPort Delay(ms)
    SERIAL_SNDELAY: CONFIG.serial_sendDelay,
    SERIAL_RETYRCNT: CONFIG.serial_maxRetry,
    SOCKET_SNDELAY: CONFIG.socket_sendDelay,
    SOCKET_RETYRCNT: CONFIG.socket_maxRetry,
    // MQTT 수신 Delay(ms)
    MQTT_DELAY: 5000,
    // 메시지 Prefix 상수
    MSG_PREFIX: [0x02],
    MSG_HEADER1: [0x31, 0x41, 0x42, 0xd1, 0x28, 0x61, 0xc1],
    MSG_HEADER2: [0x51, 0x52, 0x53, 0x54, 0x28, 0x31, 0x61, 0xc1],
    // 디바이스 Hex코드
    DEVICE_STATE: [
        { deviceId: 'Room', subId: '' },
        { deviceId: 'Gas', subId: '' },
        { deviceId: 'Doorlock', subId: '' },
        { deviceId: 'Fan', subId: '' },
        { deviceId: 'Thermo', subId: '' },
        { deviceId: 'Elevator', subId: '' }
    ],

    DEVICE_COMMAND1: [
        { deviceId: 'Room', subId: '1', commandHex: Buffer.alloc(10, '02510A12A801010000E9', 'hex'), light1: 'ON' },
        { deviceId: 'Room', subId: '1', commandHex: Buffer.alloc(10, '02510A12AD00010000E7', 'hex'), light1: 'OFF' },
        { deviceId: 'Room', subId: '1', commandHex: Buffer.alloc(10, '02510A12AF01020000E9', 'hex'), light2: 'ON' },
        { deviceId: 'Room', subId: '1', commandHex: Buffer.alloc(10, '02510A12B40002000001', 'hex'), light2: 'OFF' },
        { deviceId: 'Room', subId: '1', commandHex: Buffer.alloc(10, '02510A12B701040000FB', 'hex'), light3: 'ON' },
        { deviceId: 'Room', subId: '1', commandHex: Buffer.alloc(10, '02510A12BE00040000F9', 'hex'), light3: 'OFF' },
        { deviceId: 'Room', subId: '1', commandHex: Buffer.alloc(10, '02510A12C1010800009D', 'hex'), light4: 'ON' },
        { deviceId: 'Room', subId: '1', commandHex: Buffer.alloc(10, '02510A12C60008000085', 'hex'), light4: 'OFF' },
        { deviceId: 'Room', subId: '1', commandHex: Buffer.alloc(10, '02510A12CB011000009B', 'hex'), light5: 'ON' },
        { deviceId: 'Room', subId: '1', commandHex: Buffer.alloc(10, '02510A12D100100000B4', 'hex'), light5: 'OFF' },//방1
        { deviceId: 'Room', subId: '2', commandHex: Buffer.alloc(10, '02520A12DC010100009A', 'hex'), light1: 'ON' },
        { deviceId: 'Room', subId: '2', commandHex: Buffer.alloc(10, '02520A12E100010000B4', 'hex'), light1: 'OFF' },
        { deviceId: 'Room', subId: '2', commandHex: Buffer.alloc(10, '02520A12E401020000AF', 'hex'), light2: 'ON' },
        { deviceId: 'Room', subId: '2', commandHex: Buffer.alloc(10, '02520A12EA00020000A8', 'hex'), light2: 'OFF' },
        { deviceId: 'Room', subId: '2', commandHex: Buffer.alloc(10, '02520A12ED01040000AA', 'hex'), light3: 'ON' },
        { deviceId: 'Room', subId: '2', commandHex: Buffer.alloc(10, '02520A12F200040000BE', 'hex'), light3: 'OFF' },//방2
        { deviceId: 'Room', subId: '3', commandHex: Buffer.alloc(10, '02530A125A0101000019', 'hex'), light1: 'ON' },
        { deviceId: 'Room', subId: '3', commandHex: Buffer.alloc(10, '02530A12620001000034', 'hex'), light1: 'OFF' },
        { deviceId: 'Room', subId: '3', commandHex: Buffer.alloc(10, '02530A1266010200002C', 'hex'), light2: 'ON' },
        { deviceId: 'Room', subId: '3', commandHex: Buffer.alloc(10, '02530A126D0002000024', 'hex'), light2: 'OFF' },  //방3
        { deviceId: 'Room', subId: '4', commandHex: Buffer.alloc(10, '02540A12CC0101000088', 'hex'), light1: 'ON' },
        { deviceId: 'Room', subId: '4', commandHex: Buffer.alloc(10, '02540A12D100010000A2', 'hex'), light1: 'OFF' },  //방4

        { deviceId: 'Room', subId: '1', commandHex: Buffer.alloc(10, '', 'hex'), outlet1: 'ON' },
        { deviceId: 'Room', subId: '1', commandHex: Buffer.alloc(10, '', 'hex'), outlet1: 'OFF' },
        { deviceId: 'Room', subId: '1', commandHex: Buffer.alloc(10, '', 'hex'), outlet2: 'ON' },
        { deviceId: 'Room', subId: '1', commandHex: Buffer.alloc(10, '', 'hex'), outlet2: 'OFF' },  //방1
        { deviceId: 'Room', subId: '2', commandHex: Buffer.alloc(12, '02520C122D0000000101016A', 'hex'), outlet1: 'ON' },
        { deviceId: 'Room', subId: '2', commandHex: Buffer.alloc(12, '02520C12280000000101026C', 'hex'), outlet1: 'OFF' },
        { deviceId: 'Room', subId: '2', commandHex: Buffer.alloc(12, '02520C12380000000102017E', 'hex'), outlet2: 'ON' },
        { deviceId: 'Room', subId: '2', commandHex: Buffer.alloc(12, '02520C123300000001020286', 'hex'), outlet2: 'OFF' },  //방2
        { deviceId: 'Room', subId: '3', commandHex: Buffer.alloc(12, '02530C124E0000000101010A', 'hex'), outlet1: 'ON' },
        { deviceId: 'Room', subId: '3', commandHex: Buffer.alloc(12, '02530C12490000000101020A', 'hex'), outlet1: 'OFF' },
        { deviceId: 'Room', subId: '3', commandHex: Buffer.alloc(12, '02530C125700000001020122', 'hex'), outlet2: 'ON' },
        { deviceId: 'Room', subId: '3', commandHex: Buffer.alloc(12, '02530C125200000001020224', 'hex'), outlet2: 'OFF' },  //방3
        { deviceId: 'Room', subId: '4', commandHex: Buffer.alloc(12, '02540C12660000000101012D', 'hex'), outlet1: 'ON' },
        { deviceId: 'Room', subId: '4', commandHex: Buffer.alloc(12, '02540C126100000001010235', 'hex'), outlet1: 'OFF' },
        { deviceId: 'Room', subId: '4', commandHex: Buffer.alloc(12, '02540C126F00000001020125', 'hex'), outlet2: 'ON' },
        { deviceId: 'Room', subId: '4', commandHex: Buffer.alloc(12, '02540C126A0000000102022F', 'hex'), outlet2: 'OFF' },  //방4

        { deviceId: 'Room', subId: '1', commandHex: Buffer.alloc(12, '02510C12190000000101104A', 'hex'), idlePower1: 'ON' },
        { deviceId: 'Room', subId: '1', commandHex: Buffer.alloc(12, '02510C121F00000001012078', 'hex'), idlePower1: 'OFF' },
        { deviceId: 'Room', subId: '1', commandHex: Buffer.alloc(12, '02510C12240000000102107E', 'hex'), idlePower2: 'ON' },
        { deviceId: 'Room', subId: '1', commandHex: Buffer.alloc(12, '02510C12290000000102204D', 'hex'), idlePower2: 'OFF' },
        { deviceId: 'Room', subId: '2', commandHex: Buffer.alloc(12, '02520C12B000000001011012', 'hex'), idlePower1: 'ON' },
        { deviceId: 'Room', subId: '2', commandHex: Buffer.alloc(12, '02520C12BC000000010120D6', 'hex'), idlePower1: 'OFF' },
        { deviceId: 'Room', subId: '2', commandHex: Buffer.alloc(12, '02520C12C700000001021084', 'hex'), idlePower2: 'ON' },
        { deviceId: 'Room', subId: '2', commandHex: Buffer.alloc(12, '02520C12CE000000010220A7', 'hex'), idlePower2: 'OFF' },
        { deviceId: 'Room', subId: '3', commandHex: Buffer.alloc(12, '02530C122400000001011063', 'hex'), idlePower1: 'ON' },
        { deviceId: 'Room', subId: '3', commandHex: Buffer.alloc(12, '02530C122C0000000101204B', 'hex'), idlePower1: 'OFF' },
        { deviceId: 'Room', subId: '3', commandHex: Buffer.alloc(12, '02530C123200000001021092', 'hex'), idlePower2: 'ON' },
        { deviceId: 'Room', subId: '3', commandHex: Buffer.alloc(12, '02530C123A0000000102205A', 'hex'), idlePower2: 'OFF' },
        { deviceId: 'Room', subId: '4', commandHex: Buffer.alloc(12, '02540C126F00000001011039', 'hex'), idlePower1: 'ON' },
        { deviceId: 'Room', subId: '4', commandHex: Buffer.alloc(12, '02540C12760000000101201E', 'hex'), idlePower1: 'OFF' },
        { deviceId: 'Room', subId: '1', commandHex: Buffer.alloc(12, '02540C127D0000000102102C', 'hex'), idlePower2: 'ON' },
        { deviceId: 'Room', subId: '1', commandHex: Buffer.alloc(12, '02540C1284000000010220EF', 'hex'), idlePower2: 'OFF' },
    ], //old wallpad packet

    DEVICE_COMMAND2: [
        { deviceId: 'Room', subId: '1', commandHex: Buffer.alloc(13, '02310D010001810000000004C6', 'hex'), light1: 'ON' },
        { deviceId: 'Room', subId: '1', commandHex: Buffer.alloc(13, '02310D01000101000000000042', 'hex'), light1: 'OFF' },
        { deviceId: 'Room', subId: '1', commandHex: Buffer.alloc(13, '02310D010001820000000004C1', 'hex'), light2: 'ON' },
        { deviceId: 'Room', subId: '1', commandHex: Buffer.alloc(13, '02310D01000102000000000045', 'hex'), light2: 'OFF' },
        { deviceId: 'Room', subId: '1', commandHex: Buffer.alloc(13, '02310D010001840000000004BB', 'hex'), light3: 'ON' },
        { deviceId: 'Room', subId: '1', commandHex: Buffer.alloc(13, '02310D0100010400000000003F', 'hex'), light3: 'OFF' },
        { deviceId: 'Room', subId: '1', commandHex: Buffer.alloc(13, '02310D010001880000000004BF', 'hex'), light4: 'ON' },
        { deviceId: 'Room', subId: '1', commandHex: Buffer.alloc(13, '02310D0100010800000000003B', 'hex'), light4: 'OFF' },  //방1
        { deviceId: 'Room', subId: '2', commandHex: Buffer.alloc(13, '02310D010002810000000004C3', 'hex'), light1: 'ON' },
        { deviceId: 'Room', subId: '2', commandHex: Buffer.alloc(13, '02310D01000201000000000047', 'hex'), light1: 'OFF' },
        { deviceId: 'Room', subId: '2', commandHex: Buffer.alloc(13, '02310D010002820000000004C4', 'hex'), light2: 'ON' },
        { deviceId: 'Room', subId: '2', commandHex: Buffer.alloc(13, '02310D01000202000000000048', 'hex'), light2: 'OFF' },  //방2
        { deviceId: 'Room', subId: '3', commandHex: Buffer.alloc(13, '02310D010003810000000004C8', 'hex'), light1: 'ON' },
        { deviceId: 'Room', subId: '3', commandHex: Buffer.alloc(13, '02310D01000301000000000044', 'hex'), light1: 'OFF' },
        { deviceId: 'Room', subId: '3', commandHex: Buffer.alloc(13, '02310D010003820000000004C7', 'hex'), light2: 'ON' },
        { deviceId: 'Room', subId: '3', commandHex: Buffer.alloc(13, '02310D01000302000000000043', 'hex'), light2: 'OFF' },  //방3
        { deviceId: 'Room', subId: '4', commandHex: Buffer.alloc(13, '02310D010004810000000004C5', 'hex'), light1: 'ON' },
        { deviceId: 'Room', subId: '4', commandHex: Buffer.alloc(13, '02310D01000401000000000041', 'hex'), light1: 'OFF' },
        { deviceId: 'Room', subId: '4', commandHex: Buffer.alloc(13, '02310D010004820000000004BA', 'hex'), light2: 'ON' },
        { deviceId: 'Room', subId: '4', commandHex: Buffer.alloc(13, '02310D0100040200000000003E', 'hex'), light2: 'OFF' },  //방4
        { deviceId: 'Room', subId: '5', commandHex: Buffer.alloc(13, '02310D010005810000000004BA', 'hex'), light1: 'ON' },
        { deviceId: 'Room', subId: '5', commandHex: Buffer.alloc(13, '02310D0100050100000000003E', 'hex'), light1: 'OFF' },
        { deviceId: 'Room', subId: '5', commandHex: Buffer.alloc(13, '02310D010005820000000004C5', 'hex'), light2: 'ON' },
        { deviceId: 'Room', subId: '5', commandHex: Buffer.alloc(13, '02310D01000502000000000041', 'hex'), light2: 'OFF' },  //방5

        { deviceId: 'Room', subId: '1', commandHex: Buffer.alloc(13, '02310D010001008100000009CB', 'hex'), outlet1: 'ON' },
        { deviceId: 'Room', subId: '1', commandHex: Buffer.alloc(13, '02310D01000100010000000044', 'hex'), outlet1: 'OFF' },
        { deviceId: 'Room', subId: '1', commandHex: Buffer.alloc(13, '02310D010001008200000012D3', 'hex'), outlet2: 'ON' },
        { deviceId: 'Room', subId: '1', commandHex: Buffer.alloc(13, '02310D01000100020000000041', 'hex'), outlet2: 'OFF' },  //방1
        { deviceId: 'Room', subId: '2', commandHex: Buffer.alloc(13, '02310D010002008100000009CE', 'hex'), outlet1: 'ON' },
        { deviceId: 'Room', subId: '2', commandHex: Buffer.alloc(13, '02310D01000200010000000045', 'hex'), outlet1: 'OFF' },
        { deviceId: 'Room', subId: '2', commandHex: Buffer.alloc(13, '02310D010002008200000012D6', 'hex'), outlet2: 'ON' },
        { deviceId: 'Room', subId: '2', commandHex: Buffer.alloc(13, '02310D01000200020000000048', 'hex'), outlet2: 'OFF' },  //방2
        { deviceId: 'Room', subId: '3', commandHex: Buffer.alloc(13, '02310D010003008100000009CD', 'hex'), outlet1: 'ON' },
        { deviceId: 'Room', subId: '3', commandHex: Buffer.alloc(13, '02310D01000300010000000046', 'hex'), outlet1: 'OFF' },
        { deviceId: 'Room', subId: '3', commandHex: Buffer.alloc(13, '02310D010003008200000012D5', 'hex'), outlet2: 'ON' },
        { deviceId: 'Room', subId: '3', commandHex: Buffer.alloc(13, '02310D01000300020000000047', 'hex'), outlet2: 'OFF' },  //방3
        { deviceId: 'Room', subId: '4', commandHex: Buffer.alloc(13, '02310D010004008100000009B8', 'hex'), outlet1: 'ON' },
        { deviceId: 'Room', subId: '4', commandHex: Buffer.alloc(13, '02310D0100040001000000003F', 'hex'), outlet1: 'OFF' },
        { deviceId: 'Room', subId: '4', commandHex: Buffer.alloc(13, '02310D010004008200000012B0', 'hex'), outlet2: 'ON' },
        { deviceId: 'Room', subId: '4', commandHex: Buffer.alloc(13, '02310D0100040002000000003E', 'hex'), outlet2: 'OFF' },  //방4
        { deviceId: 'Room', subId: '5', commandHex: Buffer.alloc(13, '02310D010005008100000009B7', 'hex'), outlet1: 'ON' },
        { deviceId: 'Room', subId: '5', commandHex: Buffer.alloc(13, '02310D01000500010000000040', 'hex'), outlet1: 'OFF' },
        { deviceId: 'Room', subId: '5', commandHex: Buffer.alloc(13, '02310D010005008200000012AF', 'hex'), outlet2: 'ON' },
        { deviceId: 'Room', subId: '5', commandHex: Buffer.alloc(13, '02310D0100050002000000003D', 'hex'), outlet2: 'OFF' },  //방5

        { deviceId: 'Room', subId: '1', commandHex: Buffer.alloc(13, '02310D010001000083000000C0', 'hex'), idlePower: 'ON' },
        { deviceId: 'Room', subId: '1', commandHex: Buffer.alloc(13, '02310D01000100000300000040', 'hex'), idlePower: 'OFF' },
        { deviceId: 'Room', subId: '2', commandHex: Buffer.alloc(13, '02310D010002000083000000C5', 'hex'), idlePower: 'ON' },
        { deviceId: 'Room', subId: '2', commandHex: Buffer.alloc(13, '02310D01000200000300000045', 'hex'), idlePower: 'OFF' },
        { deviceId: 'Room', subId: '3', commandHex: Buffer.alloc(13, '02310D010003000083000000C6', 'hex'), idlePower: 'ON' },
        { deviceId: 'Room', subId: '3', commandHex: Buffer.alloc(13, '02310D01000300000300000046', 'hex'), idlePower: 'OFF' },
        { deviceId: 'Room', subId: '4', commandHex: Buffer.alloc(13, '02310D010004000083000000C3', 'hex'), idlePower: 'ON' },
        { deviceId: 'Room', subId: '4', commandHex: Buffer.alloc(13, '02310D01000400000300000043', 'hex'), idlePower: 'OFF' },
        { deviceId: 'Room', subId: '5', commandHex: Buffer.alloc(13, '02310D010005000083000000BC', 'hex'), idlePower: 'ON' },
        { deviceId: 'Room', subId: '5', commandHex: Buffer.alloc(13, '02310D0100050000030000003C', 'hex'), idlePower: 'OFF' },

        { deviceId: 'Fan', subId: '', commandHex: Buffer.alloc(10, '0261010000010100006E', 'hex'), power: 'ON' }, //켜짐
        { deviceId: 'Fan', subId: '', commandHex: Buffer.alloc(10, '0261010000000100006B', 'hex'), power: 'OFF' }, //꺼짐
        { deviceId: 'Fan', subId: '', commandHex: Buffer.alloc(10, '0261030000000100006D', 'hex'), preset: 'low' }, //약(켜짐)
        { deviceId: 'Fan', subId: '', commandHex: Buffer.alloc(10, '0261030000000200006C', 'hex'), preset: 'mid' }, //중(켜짐)
        { deviceId: 'Fan', subId: '', commandHex: Buffer.alloc(10, '0261030000000300006B', 'hex'), preset: 'high' }, //강(켜짐)
        { deviceId: 'Fan', subId: '', commandHex: Buffer.alloc(10, '0261070000100000007A', 'hex'), preset: 'nature OFF' }, //자연환기(꺼짐)
        { deviceId: 'Fan', subId: '', commandHex: Buffer.alloc(10, '0261070000000000006A', 'hex'), preset: 'nature ON' }, //자연환기(켜짐)

        { deviceId: 'Thermo', subId: '1', commandHex: Buffer.alloc(14, '02280E1200010100000000000040', 'hex'), power: 'heat' }, // 온도조절기1-ON
        { deviceId: 'Thermo', subId: '1', commandHex: Buffer.alloc(14, '02280E1200010200000000000041', 'hex'), power: 'off' }, // 온도조절기1-OFF
        { deviceId: 'Thermo', subId: '2', commandHex: Buffer.alloc(14, '02280E120002010000000000003B', 'hex'), power: 'heat' },
        { deviceId: 'Thermo', subId: '2', commandHex: Buffer.alloc(14, '02280E120002020000000000003E', 'hex'), power: 'off' },
        { deviceId: 'Thermo', subId: '3', commandHex: Buffer.alloc(14, '02280E120003010000000000003E', 'hex'), power: 'heat' },
        { deviceId: 'Thermo', subId: '3', commandHex: Buffer.alloc(14, '02280E120003020000000000003B', 'hex'), power: 'off' },
        { deviceId: 'Thermo', subId: '4', commandHex: Buffer.alloc(14, '02280E1200040100000000000039', 'hex'), power: 'heat' },
        { deviceId: 'Thermo', subId: '4', commandHex: Buffer.alloc(14, '02280E1200040200000000000038', 'hex'), power: 'off' },
        { deviceId: 'Thermo', subId: '5', commandHex: Buffer.alloc(14, '02280E120005010000000000003C', 'hex'), power: 'heat' },
        { deviceId: 'Thermo', subId: '5', commandHex: Buffer.alloc(14, '02280E120005020000000000003D', 'hex'), power: 'off' },
        { deviceId: 'Thermo', subId: '1', commandHex: Buffer.alloc(14, '02280E12FF0100FF0000000000FF', 'hex'), setTemp: '' }, // 온도조절기1-온도설정
        { deviceId: 'Thermo', subId: '2', commandHex: Buffer.alloc(14, '02280E12FF0200FF0000000000FF', 'hex'), setTemp: '' },
        { deviceId: 'Thermo', subId: '3', commandHex: Buffer.alloc(14, '02280E12FF0300FF0000000000FF', 'hex'), setTemp: '' },
        { deviceId: 'Thermo', subId: '4', commandHex: Buffer.alloc(14, '02280E12FF0400FF0000000000FF', 'hex'), setTemp: '' },
        { deviceId: 'Thermo', subId: '5', commandHex: Buffer.alloc(14, '02280E12FF0500FF0000000000FF', 'hex'), setTemp: '' },

        { deviceId: 'Gas', subId: '', commandHex: Buffer.alloc(10, '0231020000000000003D', 'hex'), power: 'OFF' },
        { deviceId: 'Doorlock', subId: '', commandHex: Buffer.alloc(10, '0241020001000000004E', 'hex'), power: 'ON' },
        { deviceId: 'Elevator', subId: '', commandHex: Buffer.alloc(12), power: 'ON' },
    ],

    // 상태 Topic (/homenet/${deviceId}${subId}/${property}/state/ = ${value})
    // 명령어 Topic (/homenet/${deviceId}${subId}/${property}/command/ = ${value})
    TOPIC_PRFIX: mqttVar.topic_prefix,
    STATE_TOPIC: mqttVar.state_topic,  //상태 전달
    DEVICE_TOPIC: mqttVar.device_topic //명령 수신
};

// 베스틴 홈넷용 시리얼 통신 파서 : 메시지 길이나 구분자가 불규칙하여 별도 파서 정의
class CustomParser {
    constructor(options) {
        util.inherits(CustomParser, Transform);
        Transform.call(this, options);
        this._queueChunk = [];
        this._msgLenCount = 0;
        this._msgLength = 0;
        this._msgTypeFlag = false;
    }
    _transform(chunk, encoding, done) {
        var start = 0;
        for (var i = 0; i < chunk.length; i++) {
            if (CONST.WALLPAD_TYPE == 'new') {
                if (CONST.MSG_PREFIX.includes(chunk[i]) && CONST.MSG_HEADER1.includes(chunk[i + 1])) { // 청크에 구분자(MSG_PREFIX)가 있으면
                    this._queueChunk.push(chunk.slice(start, i, i + 1)); // 구분자 앞부분을 큐에 저장하고
                    this.push(Buffer.concat(this._queueChunk)); // 큐에 저장된 메시지들 합쳐서 내보냄
                    this._queueChunk = []; // 큐 초기화
                    this._msgLenCount = 0;
                    start = i;
                    this._msgTypeFlag = true; // 다음 바이트는 메시지 종류
                }
            } else if (CONST.WALLPAD_TYPE == 'old') {
                if (CONST.MSG_PREFIX.includes(chunk[i]) && CONST.MSG_HEADER2.includes(chunk[i + 1])) { // 청크에 구분자(MSG_PREFIX)가 있으면
                    this._queueChunk.push(chunk.slice(start, i, i + 1)); // 구분자 앞부분을 큐에 저장하고
                    this.push(Buffer.concat(this._queueChunk)); // 큐에 저장된 메시지들 합쳐서 내보냄
                    this._queueChunk = []; // 큐 초기화
                    this._msgLenCount = 0;
                    start = i;
                    this._msgTypeFlag = true; // 다음 바이트는 메시지 종류
                }
            }

            // 메시지 종류에 따른 메시지 길이 파악
            else if (this._msgTypeFlag) {
                if (CONST.WALLPAD_TYPE == 'new') {
                    switch (chunk[i + 2]) {
                        case 0x07:
                            this._msgLength = 7; break;
                        case 0x08:
                            this._msgLength = 8; break;
                        case 0x10: case 0x80: case 0x81:
                            this._msgLength = 10; break;
                        case 0x30:
                            this._msgLength = 20; break;
                        case 0x1e:
                            this._msgLength = 30; break;
                        default:
                            this._msgLength = 0;
                    }
                } else if (CONST.WALLPAD_TYPE == 'old') {
                    switch (chunk[i + 2]) {
                        case 0x0a:
                            this._msgLength = 10; break;
                        case 0x0c:
                            this._msgLength = 12; break;
                        case 0x14:
                            this._msgLength = 20; break;
                        default:
                            this._msgLength = 0;
                    }
                }
                this._msgTypeFlag = false;
            }
            this._msgLenCount++;
        }
        // 구분자가 없거나 구분자 뒷부분 남은 메시지 큐에 저장
        this._queueChunk.push(chunk.slice(start));

        // 메시지 길이를 확인하여 다 받았으면 내보냄
        if (this._msgLenCount >= this._msgLength) {
            this.push(Buffer.concat(this._queueChunk)); // 큐에 저장된 메시지들 합쳐서 내보냄
            this._queueChunk = []; // 큐 초기화
            this._msgLenCount = 0;
        }

        done();
    }
}

// 로그 표시 
var log = (...args) => console.log('[' + new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) + ']', args.join(' '));

// 홈컨트롤 상태
var homeStatus = {};
var lastReceive = new Date().getTime();   //serial
var lastReceive2 = new Date().getTime();  //socket
var mqttReady = false;
var queue = new Array();
var retryCnt = 0;  // 수정금지
var packet1 = {};  //energy
var packet2 = {};  //control
var packet3 = {};  //smart

// MQTT-Broker 연결 
const client = mqtt.connect('mqtt://' + mqttVar.broker, {
    port: mqttVar.port,
    username: mqttVar.username,
    password: mqttVar.password,
    clientId: mqttVar.clientId,
}, log("INFO   initialize mqtt..."));
client.on('connect', () => {
    log("INFO   MQTT connection successful!", "(" + mqttVar.broker, mqttVar.port + ")");
    client.subscribe(CONST.DEVICE_TOPIC, (err) => { if (err) log('ERROR   MQTT subscribe fail! -', CONST.DEVICE_TOPIC) });
});
client.on('error', err => {
    if (err.code == "ECONNREFUSED") {
        log("ERROR   Make sure mqtt broker is enabled")
    } else { log("ERROR   MQTT connection failed: " + err.message); }
});
client.on("offline", () => {
    log("WARNING   MQTT currently offline. Please check mqtt broker!");
});
client.on("reconnect", () => {
    log("INFO   MQTT reconnection starting...");
});

if (CONST.WALLPAD_TYPE == 'old') {
    log('INFO   WallPad-TYPE as Old Version')
    if (portVar.type == 'serial') {
        log('INFO   connection type: Serial')
        log('INFO   initialize serial...')
        RS485 = new SerialPort({
            path: CONST.portName,
            baudRate: 9600,
            dataBits: 8,
            parity: 'none',
            stopBits: 1,
            autoOpen: false,
            encoding: 'hex'
        });
        parser = RS485.pipe(new CustomParser());
        RS485.on('open', () => log('INFO   Success open port:', CONST.portName));
        RS485.on('close', () => log('WARNING   Close port:', CONST.portName));
        RS485.open((err) => {
            if (err) {
                return log('ERROR  Failed to open port:', err.message);
            }
        });
    }
    else {
        log('INFO   connection type: Socket')
        log('INFO   initialize socket...')
        RS485 = new net.Socket();
        RS485.connect(portVar.port, portVar.addr, function () {
            log('INFO   Success connected to server', "(" + portVar.addr, portVar.port + ")");
        });
        RS485.on('error', (err) => {
            log('ERROR   server connection failed:', err.message)
        });
        parser = RS485.pipe(new CustomParser());
    };
};

// Energy
if (CONST.WALLPAD_TYPE == 'new') {
    log('INFO   WallPad-TYPE as New Version')
    if (energyVar.type == 'serial') {
        log('INFO   Energy connection type: Serial')
        log('INFO   initialize serial...')
        energy485 = new SerialPort({
            path: CONST.portEN,
            baudRate: 9600,
            dataBits: 8,
            parity: 'none',
            stopBits: 1,
            autoOpen: false,
            encoding: 'hex'
        });
        energy = energy485.pipe(new CustomParser());
        energy485.on('open', () => log('INFO   Success open energy port:', CONST.portEN));
        energy485.on('close', () => log('WARNING   Close energy port:', CONST.portEN));
        energy485.open((err) => {
            if (err) {
                return log('ERROR  Failed to open energy port:', err.message);
            }
        });
    }
    else {
        log('INFO   Energy connection type: Socket')
        log('INFO   initialize socket...')
        energy485 = new net.Socket();
        energy485.connect(energyVar.port, energyVar.addr, function () {
            log('INFO   Success connected to energy', "(" + energyVar.addr, energyVar.port + ")");
        });
        energy485.on('error', (err) => {
            log('ERROR   Energy connection failed:', err.message)
        });
        energy = energy485.pipe(new CustomParser());
    };

    // Control 
    if (controlVar.type == 'serial') {
        log('INFO   Control connection type: Serial')
        log('INFO   initialize serial...')
        control485 = new SerialPort({
            path: CONST.portCTRL,
            baudRate: 9600,
            dataBits: 8,
            parity: 'none',
            stopBits: 1,
            autoOpen: false,
            encoding: 'hex'
        });
        control = control485.pipe(new CustomParser());
        control485.on('open', () => log('INFO   Success open control port:', CONST.portCTRL));
        control485.on('close', () => log('WARNING   Close control port:', CONST.portCTRL));
        control485.open((err) => {
            if (err) {
                return log('ERROR   Failed to open control port:', err.message);
            }
        });
    }
    else {
        log('INFO   Control connection type: Socket')
        log('INFO   initialize socket...')
        control485 = new net.Socket();
        control485.connect(controlVar.port, controlVar.addr, function () {
            log('INFO   Success connected to control', "(" + controlVar.addr, controlVar.port + ")");
        });
        control485.on('error', (err) => {
            if (err.code == "ETIMEDOUT") {
                log("ERROR   Make sure socket is activated")
            } else { log('ERROR   Control connection failed:', err.message) }
        });
        control = control485.pipe(new CustomParser());
    };

    // Smart
    if (smartVar.enable == 'on') {
        if (smartVar.recv_type == 'serial') {
            log('INFO   Smart1 connection type: Serial')
            log('INFO   initialize serial...')
            smart1485 = new SerialPort({
                path: CONST.portRECV,
                baudRate: 9600,
                dataBits: 8,
                parity: 'none',
                stopBits: 1,
                autoOpen: false,
                encoding: 'hex'
            });
            smart1 = smart1485.pipe(new CustomParser());
            smart1485.on('open', () => log('INFO   Success open smart1 port:', CONST.portRECV));
            smart1485.on('close', () => log('WARNING   Close smart1 port:', CONST.portRECV));
            smart1485.open((err) => {
                if (err) {
                    return log('ERROR   Failed to open smart1 port:', err.message);
                }
            });
        } else if (smartVar.recv_type == 'socket') {
            log('INFO   Smart1 connection type: Socket')
            log('INFO   initialize socket...')
            smart1485 = new net.Socket();
            smart1485.connect(smartVar.recv_port, smartVar.recv_addr, function () {
                log('INFO   Success connected to smart1', "(" + smartVar.recv_addr, smartVar.recv_port + ")");
            });
            smart1485.on('error', (err) => {
                if (err.code == "ETIMEDOUT") {
                    log("ERROR   Make sure socket is activated")
                } else { log('ERROR   Smart1 connection failed:', err.message) }
            });
            smart1 = smart1485.pipe(new CustomParser());
        }
        if (smartVar.send_type == 'serial') {
            log('INFO   Smart2 connection type: Serial')
            log('INFO   initialize serial...')
            smart2485 = new SerialPort({
                path: CONST.portSEND,
                baudRate: 9600,
                dataBits: 8,
                parity: 'none',
                stopBits: 1,
                autoOpen: false,
                encoding: 'hex'
            });
            smart2 = smart2485.pipe(new CustomParser());
            smart2485.on('open', () => log('INFO   Success open smart2 port:', CONST.portSEND));
            smart2485.on('close', () => log('WARNING   Close smart2 port:', CONST.portSEND));
            smart2485.open((err) => {
                if (err) {
                    return log('ERROR   Failed to open smart2 port:', err.message);
                }
            });
        } else if (smartVar.send_type == 'socket') {
            log('INFO   Smart2 connection type: Socket')
            log('INFO   initialize socket...')
            smart2485 = new net.Socket();
            smart2485.connect(smartVar.send_port, smartVar.send_addr, function () {
                log('INFO   Success connected to smart2', "(" + smartVar.send_addr, smartVar.send_port + ")");
            });
            smart2485.on('error', (err) => {
                if (err.code == "ETIMEDOUT") {
                    log("ERROR   Make sure socket is activated")
                } else { log('ERROR   Smart2 connection failed:', err.message) }
            });
            smart2 = smart2485.pipe(new CustomParser());
        }
    }
};

function CheckSum(data, count) {
    var sum = AddSum(data, count);
    if (sum != data[count]) {
        return sum;
    }
    return true;
}

function AddSum(data, count) {
    var sum = 0x03;
    for (var i = 0; i < count; i++) {
        sum = ((data[i] ^ sum) + 1) & 0xff
    }
    return sum;
}

// 홈넷에서 SerialPort로 상태 정보 수신
if (CONST.WALLPAD_TYPE == 'new') {
    energy.on('data', function (data) {
        lastReceive = new Date().getTime();
        lastReceive2 = new Date().getTime();
        //console.log('Energy>> Receive interval: ', (new Date().getTime()) - lastReceive, 'ms ->', data.toString('hex'));
        packet1 = {
            //timestamp: data.slice(4, 5).toString('hex'),
            room_idx: data.slice(5, 6).toString('hex'),
            power: data.slice(7, 8).toString('hex')
        }
        if (data[0] != 0x02) return;
        if (data[2] == 0x1e) {
            switch (data[3]) {
                case 0x91: //상태
                    let objFound = CONST.DEVICE_STATE.find(obj => obj.deviceId === 'Room');
                    if (objFound) {
                        //조명, 콘센트 상태 정보
                        objFound.subId = packet1.room_idx.substr(1);
                        //console.log(objFound.subId)
                        objFound.curPower1 = ((data[14] * 256 + data[15]) / 10).toString(10);
                        objFound.curPower2 = ((data[16] * 256 + data[17]) / 10).toString(10);
                        objFound.curPower3 = ((data[18] * 256 + data[19]) / 10).toString(10);
                        objFound.light1 = (data[6] & 0x01) ? 'ON' : 'OFF'
                        objFound.light2 = (data[6] & 0x02) ? 'ON' : 'OFF'
                        objFound.light3 = (data[6] & 0x04) ? 'ON' : 'OFF'
                        objFound.light4 = (data[6] & 0x08) ? 'ON' : 'OFF'
                        objFound.outlet1 = (data[7] & 0x01) ? 'ON' : 'OFF'
                        objFound.outlet2 = (data[7] & 0x02) ? 'ON' : 'OFF'
                        packet1.power = Number(packet1.power.substr(0, 1));
                        objFound.idlePower = (packet1.power == 9) ? 'ON' : 'OFF'
                        //console.log(objFound.power)
                    }
                    updateStatus(objFound);

                case 0x81:
                    let objFoundIdx = CONST.DEVICE_COMMAND2.find(obj => obj.deviceId === 'Room');
                    objFoundIdx = queue.findIndex(e => ((data[3] == 0x81) && (data[0] == e.commandHex[0]) && (data[1] == e.commandHex[1])));
                    if (objFoundIdx > -1) {
                        log('INFO   Success command from Ack # Set State=', retryCnt);
                        queue.splice(objFoundIdx, 1);
                        retryCnt = 0;
                    }
            }
        }
    });

    control.on('data', function (data) {
        lastReceive = new Date().getTime();
        lastReceive2 = new Date().getTime();
        //console.log('Control>> Receive interval: ', (new Date().getTime()) - lastReceive, 'ms ->', data.toString('hex'));
        /** 
        packet2 = {
            timestamp: data.slice(4, 5).toString('hex'),
        }*/

        if (data[0] != 0x02) return;
        switch (data[1]) {
            case 0x31:
                switch (data[2]) {
                    case 0x80: //상태
                        let objFound = CONST.DEVICE_STATE.find(obj => obj.deviceId === 'Gas');
                        if (objFound) {
                            objFound.power = (data[5] == 0x01) ? 'ON' : 'OFF'
                            updateStatus(objFound);
                        }

                    case 0x82: //제어
                        let objFoundIdx = CONST.DEVICE_COMMAND2.find(obj => obj.deviceId === 'Gas');
                        objFoundIdx = queue.findIndex(e => ((data[2] == 0x82) && (data[0] == e.commandHex[0]) && (data[1] == e.commandHex[1])));
                        if (objFoundIdx > -1) {
                            log('INFO   Success command from Ack # Set State=', retryCnt);
                            queue.splice(objFoundIdx, 1);
                            retryCnt = 0;
                        }
                }
                break;

            case 0x41:
                switch (data[2]) {
                    case 0x80: //상태
                        let objFound = CONST.DEVICE_STATE.find(obj => obj.deviceId === 'Doorlock');
                        if (objFound) {
                            objFound.power = (data[5] == 0x52) ? 'ON' : 'OFF'
                            updateStatus(objFound);
                        }

                    case 0x82: //제어
                        let objFoundIdx = CONST.DEVICE_COMMAND2.find(obj => obj.deviceId === 'Doorlock');
                        objFoundIdx = queue.findIndex(e => ((data[2] == 0x82) && (data[0] == e.commandHex[0]) && (data[1] == e.commandHex[1])));
                        if (objFoundIdx > -1) {
                            log('INFO   Success command from Ack # Set State=', retryCnt);
                            queue.splice(objFoundIdx, 1);
                            retryCnt = 0;
                        }
                }
                break;

            case 0x61: //상태
                switch (data[2]) {
                    case 0x80:
                        let objFound = CONST.DEVICE_STATE.find(obj => obj.deviceId === 'Fan');
                        if (objFound) {
                            if (data[5] == 0x00 | data[5] == 0x01) {
                                objFound.power = (data[5] == 0x01) ? 'ON' : 'OFF'
                            } else {
                                objFound.power = (data[5] == 0x11) ? 'nature ON' : 'nature OFF'
                            }
                            switch (data[6]) {
                                case 0x01: objFound.preset = 'low'; break;
                                case 0x02: objFound.preset = 'mid'; break;
                                case 0x03: objFound.preset = 'high'; break;
                            }
                            updateStatus(objFound);
                        }

                    case 0x81: case 0x83: case 0x87: //제어
                        let objFoundIdx = CONST.DEVICE_COMMAND2.find(obj => obj.deviceId === 'Fan');
                        objFoundIdx = queue.findIndex(e => ((data[2] == 0x81|data[2] == 0x83|data[2] == 0x87) && (data[0] == e.commandHex[0]) && (data[1] == e.commandHex[1])));
                        if (objFoundIdx > -1) {
                            log('INFO   Success command from Ack # Set State=', retryCnt);
                            queue.splice(objFoundIdx, 1);
                            retryCnt = 0;
                        }
                }
                break;
        
            case 0x28:
                switch (data[3]) {
                    case 0x91:
                        let objFound = CONST.DEVICE_STATE.find(obj => obj.deviceId === 'Thermo')
                        //난방 상태 정보
                        objFound.subId = data[5].toString();
                        //console.log(objFound.subId)
                        //0x01: 켜짐, 0x02: 꺼짐, 0x07: 대기, 0x11: 켜짐
                        if (data[6] == 0x01 | data[6] == 0x11) { objFound.power = 'heat' }
                        else if (data[6] == 0x02 | data[6] == 0x07) { objFound.power = 'off' }
                        objFound.setTemp = ((data[7] & 0x3f) + ((data[7] & 0x40) / 128)).toString(10);
                        objFound.curTemp = ((data[8] * 256 + data[9]) / 10.0).toString(10);
                        updateStatus(objFound);

                    case 0x92: //제어
                        let objFoundIdx = CONST.DEVICE_COMMAND2.find(obj => obj.deviceId === 'Thermo');
                        objFoundIdx = queue.findIndex(e => ((data[3] == 0x92) && (data[0] == e.commandHex[0]) && (data[1] == e.commandHex[1])));
                        if (objFoundIdx > -1) {
                            log('INFO   Success command from Ack # Set State=', retryCnt);
                            queue.splice(objFoundIdx, 1);
                            retryCnt = 0;
                        }
                }
                break;
        }
    });
};

// 홈넷에서 SerialPort로 상태 정보 수신
if (CONST.WALLPAD_TYPE == 'old') {
    parser.on('data', function (data) {
        lastReceive = new Date().getTime();
        //console.log('Energy>> Receive interval: ', (new Date().getTime()) - lastReceive, 'ms ->', data.toString('hex'));
        if (data[3] == 0x91) {
            //console.log('Energy>> Receive interval: ', (new Date().getTime()) - lastReceive, 'ms ->', data.toString('hex'));
        };
        if (data[0] != 0x02) return;

        if (data[2] == 0x14) {
            switch (data[3]) {
                case 0x91: //상태
                    let objFound = CONST.DEVICE_STATE.find(obj => obj.deviceId === 'Room');
                    if (objFound) {
                        //조명, 콘센트 상태 정보
                        objFound.subId = data[1].toString(16).substring(1);
                        //room = data[1].toString(16).substring(1);
                        //console.log(room)
                        //pw = data[9].toString(16).substring(0, 1);
                        objFound.curPower1 = ((data[11] + data[12]) / 10).toString(10);
                        objFound.curPower2 = ((data[15] + data[16]) / 10).toString(10);
                        objFound.light1 = (data[6] & 0x01) ? 'ON' : 'OFF'
                        objFound.light2 = (data[6] & 0x02) ? 'ON' : 'OFF'
                        objFound.light3 = (data[6] & 0x04) ? 'ON' : 'OFF'
                        objFound.light4 = (data[6] & 0x09) ? 'ON' : 'OFF'
                        objFound.light5 = (data[6] & 0x10) ? 'ON' : 'OFF'
                        objFound.outlet1 = (data[9] & 0x01) ? 'ON' : 'OFF'
                        objFound.outlet2 = (data[9] & 0x03) ? 'ON' : 'OFF'
                        objFound.idlePower1 = (data[9] & 0x02) ? 'ON' : 'OFF'
                        objFound.idlePower2 = (data[9] & 0x04) ? 'ON' : 'OFF'
                        //console.log('Outlet1>>', data[9] & 0x01);
                        //console.log('Outlet2>>', data[9] & 0x03);
                        //console.log('IdlePw1>>', data[9] & 0x02);
                        //console.log('IdlePw2>>', data[9] & 0x04);
                    }
                    updateStatus(objFound);

                case 0x92:
                    let objFoundIdx = CONST.DEVICE_COMMAND1.find(obj => obj.deviceId === 'Room');
                    objFoundIdx = queue.findIndex(e => ((data[3] == 0x92) && (data[0] == e.commandHex[0]) && (data[1] == e.commandHex[1])));
                    if (objFoundIdx > -1) {
                        log('INFO   Success command from Ack # Set State=', retryCnt);
                        queue.splice(objFoundIdx, 1);
                        retryCnt = 0;
                    }
            }
        }

        switch (data[1]) {
            case 0x31:
                switch (data[2]) {
                    case 0x80: //상태
                        let objFound = CONST.DEVICE_STATE.find(obj => obj.deviceId === 'Gas');
                        if (objFound) {
                            objFound.power = (data[5] == 0x01) ? 'ON' : 'OFF'
                            updateStatus(objFound);
                        }

                    case 0x82: //제어
                        let objFoundIdx = CONST.DEVICE_COMMAND2.find(obj => obj.deviceId === 'Gas');
                        objFoundIdx = queue.findIndex(e => ((data[2] == 0x82) && (data[0] == e.commandHex[0]) && (data[1] == e.commandHex[1])));
                        if (objFoundIdx > -1) {
                            log('INFO   Success command from Ack # Set State=', retryCnt);
                            queue.splice(objFoundIdx, 1);
                            retryCnt = 0;
                        }
                }
                break;

            case 0x41:
                switch (data[2]) {
                    case 0x80: //상태
                        let objFound = CONST.DEVICE_STATE.find(obj => obj.deviceId === 'Doorlock');
                        if (objFound) {
                            objFound.power = (data[5] == 0x52) ? 'ON' : 'OFF'
                            updateStatus(objFound);
                        }

                    case 0x82: //제어
                        let objFoundIdx = CONST.DEVICE_COMMAND2.find(obj => obj.deviceId === 'Doorlock');
                        objFoundIdx = queue.findIndex(e => ((data[2] == 0x82) && (data[0] == e.commandHex[0]) && (data[1] == e.commandHex[1])));
                        if (objFoundIdx > -1) {
                            log('INFO   Success command from Ack # Set State=', retryCnt);
                            queue.splice(objFoundIdx, 1);
                            retryCnt = 0;
                        }
                }
                break;

            case 0x61: //상태
                switch (data[2]) {
                    case 0x80:
                        let objFound = CONST.DEVICE_STATE.find(obj => obj.deviceId === 'Fan');
                        if (objFound) {
                            if (data[5] == 0x00 | data[5] == 0x01) {
                                objFound.power = (data[5] == 0x01) ? 'ON' : 'OFF'
                            } else {
                                objFound.power = (data[5] == 0x11) ? 'nature ON' : 'nature OFF'
                            }
                            switch (objFound.preset = data[6]) {
                                case 0x01: objFound.preset = 'low'; break;
                                case 0x02: objFound.preset = 'mid'; break;
                                case 0x03: objFound.preset = 'high'; break;
                            }
                            updateStatus(objFound);
                        }

                    case 0x81: case 0x83: case 0x87: //제어
                        let objFoundIdx = CONST.DEVICE_COMMAND2.find(obj => obj.deviceId === 'Fan');
                        objFoundIdx = queue.findIndex(e => ((data[2] == 0x81|data[2] == 0x83|data[2] == 0x87) && (data[0] == e.commandHex[0]) && (data[1] == e.commandHex[1])));
                        if (objFoundIdx > -1) {
                            log('INFO   Success command from Ack # Set State=', retryCnt);
                            queue.splice(objFoundIdx, 1);
                            retryCnt = 0;
                        }
                }
                break;

            case 0x28:
                switch (data[3]) {
                    case 0x91:
                        let objFound = CONST.DEVICE_STATE.find(obj => obj.deviceId === 'Thermo')
                        //난방 상태 정보
                        objFound.subId = Number(data[5]);
                        //0x01: 켜짐, 0x02: 꺼짐, 0x07: 대기, 0x11: 켜짐
                        if (data[6] == 0x01 | data[6] == 0x11) { objFound.power = 'heat' }
                        else if (data[6] == 0x02 | data[6] == 0x07) { objFound.power = 'off' }
                        objFound.setTemp = ((data[7] & 0x3f) + ((data[7] & 0x40) / 128)).toString(10);
                        objFound.curTemp = ((data[8] * 256 + data[9]) / 10.0).toString(10);
                        updateStatus(objFound);

                    case 0x92: //제어
                        let objFoundIdx = CONST.DEVICE_COMMAND2.find(obj => obj.deviceId === 'Thermo');
                        objFoundIdx = queue.findIndex(e => ((data[3] == 0x92) && (data[0] == e.commandHex[0]) && (data[1] == e.commandHex[1])));
                        if (objFoundIdx > -1) {
                            log('INFO   Success command from Ack # Set State=', retryCnt);
                            queue.splice(objFoundIdx, 1);
                            retryCnt = 0;
                        }
                }
                break;
        }
    });
};

if (smartVar.enable == 'on') {
    smart1.on('data', function (data) {
        lastReceive = new Date().getTime();
        //console.log('Smart1>> Receive interval: ', (new Date().getTime()) - EVlastReceive, 'ms ->', data.toString('hex'));
        packet3 = {
            timestamp: data.slice(4, 5).toString('hex'),
            state: data.slice(11, 12).toString('hex'),
            floor: data.slice(12, 13).toString('hex')
        }

        if (data[0] != 0x02) return;
        let objFound = CONST.DEVICE_STATE.find(obj => obj.deviceId === 'Elevator');
        if (objFound) {
            if (data[3] == 0x13) {
                objFound.power = (packet3.state == '01') ? 'ON' : 'OFF'
                switch (packet3.state) {
                    case '00': objFound.direction = '대기'; break; //idle
                    case '01': objFound.direction = '이동중'; break; //moving
                    case '04': objFound.direction = '도착'; break; //arrived
                }
    
                if (data[12] == 0xFF) {
                    objFound.floor = '대기 층'
                } else if (data[12] & 0x80) {
                    objFound.floor = 'B' + (data[12] & 0x7f).toString(10) + ' 층'
                    log('smart>> Elevator Current Floor:', 'B' + (data[12] & 0x7f), '층')
                } else {
                    objFound.floor = (data[12] & 0xff).toString(10) + ' 층'
                    log('smart>> Elevator Current Floor:', (data[12] & 0xff), '층')
                }
            }
            updateStatus(objFound);
        }

        if ((data[11] == 0x01) && (data[12] == 0xff)) {
            let objFoundIdx = CONST.DEVICE_COMMAND.find(obj => obj.deviceId === 'Elevator');
            objFoundIdx = queue.findIndex(e => ((data[11] == 0x01) && (data[0] == e.commandHex[0]) && (data[1] == e.commandHex[1])));
            if (objFoundIdx > -1) {
                log('INFO   Success command from Ack # Set State=', retryCnt);
                queue.splice(objFoundIdx, 1);
                retryCnt = 0;
            }
            return;
        }
    });

    smart2.on('data', function (data) {
        lastReceive = new Date().getTime();
        //console.log('Smart2>> Receive interval: ', (new Date().getTime()) - EVlastReceive, 'ms ->', data.toString('hex'));

        if (data[0] != 0x02) return;
        let objFound = CONST.DEVICE_COMMAND.find(obj => obj.deviceId === 'Elevator');
        prefix = Buffer.from('02C10C91', 'hex')
        timestamp = Buffer.from(packet3.timestamp, 'hex')
        next_ts = Buffer.from('100100020102', 'hex')
        data = Buffer.concat([prefix, timestamp, next_ts])
        buf_sum = Buffer.from(CheckSum(data, 11).toString(16), 'hex')
        buf_commandHex = Buffer.concat([data, buf_sum])
        objFound.commandHex = buf_commandHex.toString('hex')
    });
};

// MQTT로 HA에 상태값 전송
var updateStatus = (obj) => {
    if (obj) {
        var arrStateName = Object.keys(obj);
    } else {
        return null;
    }

    // 상태값이 아닌 항목들은 제외 [deviceId, subId, stateHex, commandHex, sentTime]
    const arrFilter = ['deviceId', 'subId', 'stateHex', 'commandHex', 'sentTime'];
    const hideFilter = ['curPower1', 'curPower2', 'curPower3', 'curTemp'];
    arrStateName = arrStateName.filter(stateName => !arrFilter.includes(stateName));

    // 상태값별 현재 상태 파악하여 변경되었으면 상태 반영 (MQTT publish)
    arrStateName.forEach(function (stateName) {
        // 상태값이 없거나 상태가 같으면 반영 중지
        var curStatus = homeStatus[obj.deviceId + obj.subId + stateName];
        if (obj[stateName] == null || obj[stateName] === curStatus) return;
        // 미리 상태 반영한 device의 상태 원복 방지
        if (queue.length > 0) {
            var found = queue.find(q => q.deviceId + q.subId === obj.deviceId + obj.subId && q[stateName] === curStatus);
            // log('WARNING  ', obj.deviceId + obj.subId, '->', 'State reflection complete & skip');
            if (found != null) return;
        }
        // 상태 반영 (MQTT publish)
        homeStatus[obj.deviceId + obj.subId + stateName] = obj[stateName];
        var topic = util.format(CONST.STATE_TOPIC, obj.deviceId, obj.subId, stateName);
        client.publish(topic, obj[stateName], { retain: true });

        if (!hideFilter.includes(stateName)) {
            log('INFO   Send to HA:', topic, '->', obj[stateName]);
        }
    });
}

// HA에서 MQTT로 제어 명령 수신
client.on('message', (topic, message) => {
    if (mqttReady) {
        var topics = topic.split('/');
        var value = message.toString(); // message buffer이므로 string으로 변환
        var objFound = null;
        if (topics[0] === CONST.TOPIC_PRFIX) {
            // 온도설정 명령의 경우 모든 온도를 Hex로 정의해두기에는 많으므로 온도에 따른 시리얼 통신 메시지 생성
            if (topics[2] === 'setTemp') {
                objFound = CONST.DEVICE_COMMAND2.find(obj => obj.deviceId + obj.subId === topics[1] && obj.hasOwnProperty('setTemp'));
                objFound.commandHex[7] = Number(value);
                objFound.setTemp = String(Number(value)); // 온도값은 소수점이하는 버림
                data = objFound.commandHex;
                objFound.commandHex[13] = CheckSum(data, 11); // 마지막 Byte는 XOR SUM
            }
            // 다른 명령은 미리 정의해놓은 값을 매칭
            else {
                objFound = CONST.DEVICE_COMMAND2.find(obj => obj.deviceId + obj.subId === topics[1] && obj[topics[2]] === value);
            }
        }

        if (objFound == null) {
            log('WARNING   Receive Unknown Msg.: ', topic, ':', value);
            return;
        }

        // 현재 상태와 같으면 Skip
        if (value === homeStatus[objFound.deviceId + objFound.subId + objFound[topics[2]]]) {
            log('INFO   Receive & Skip: ', topic, ':', value);
        }
        // Serial메시지 제어명령 전송 & MQTT로 상태정보 전송
        else {
            log('INFO   Receive from HA:', topic, ':', value);
            // 최초 실행시 딜레이 없도록 sentTime을 현재시간 보다 sendDelay만큼 이전으로 설정
            if (objFound.sentTime = (new Date().getTime()) - CONST.SERIAL_SNDELAY);
            else if (objFound.sentTime2 = (new Date().getTime()) - CONST.SOCKET_SNDELAY);
            queue.push(objFound);   // 실행 큐에 저장
            updateStatus(objFound); // 처리시간의 Delay때문에 미리 상태 반영
            retryCnt = 0;
        }
    }
});


// SerialPort로 제어 명령 전송
const commandProc = () => {
    // 큐에 처리할 메시지가 없으면 종료
    if (queue.length == 0) return;

    // 기존 홈넷 RS485 메시지와 충돌하지 않도록 Delay를 줌
    var delay = (new Date().getTime()) - lastReceive;  //serial
    var delay2 = (new Date().getTime()) - lastReceive2; //socket
    if (delay < CONST.SERIAL_SNDELAY) return;
    else if (delay2 < CONST.SOCKET_SNDELAY) return;

    // 큐에서 제어 메시지 가져오기
    var obj = queue.shift();
    var objfilter = ['Fan', 'Thermo', 'Gas', 'Doorlock'];
    var objfilter2 = ['Elevator', 'LightAll'];
    typefilter = [energyVar.type, controlVar.type, smartVar.recv_type, smartVar.send_type, portVar.type];

    if (typefilter.includes('serial')) {
        if (lastReceive) {
            if (CONST.WALLPAD_TYPE == 'new') {
                if (obj.deviceId === 'Room') {
                    energy485.write(obj.commandHex, (err) => { if (err) return log('ERROR  ', 'Send Error: ', err.message); });
                    log('INFO  ', 'Energy>> Send to Device:', obj.deviceId, obj.subId, 'light/outlet', '->', obj.state, obj.commandHex.toString('hex'));
                } else if (objfilter.includes(obj.deviceId)) {
                    control485.write(obj.commandHex, (err) => { if (err) return log('ERROR  ', 'Send Error: ', err.message); });
                    log('INFO  ', 'Control>> Send to Device:', obj.deviceId, obj.subId, '->', obj.state, obj.commandHex.toString('hex'));
                } else if (objfilter2.includes(obj.deviceId)) {
                    smart2.write(obj.commandHex, (err) => { if (err) return log('ERROR  ', 'Send Error: ', err.message); });
                    log('INFO  ', 'Smart>> Send to Device:', obj.deviceId, obj.subId, '->', obj.state, obj.commandHex.toString('hex'));
                }
            }
            else if (CONST.WALLPAD_TYPE == 'old') {
                RS485.write(obj.commandHex, (err) => { if (err) return log('ERROR  ', 'Send Error: ', err.message); });
                log('INFO  ', 'RS485>> Send to Device:', obj.deviceId, obj.subId, '->', obj.state, obj.commandHex.toString('hex'));
            }
        }
    } else if (typefilter.includes('socket')) {
        if (lastReceive2) {
            if (CONST.WALLPAD_TYPE == 'new') {
                if (obj.deviceId === 'Room') {
                    energy485.write(obj.commandHex, (err) => { if (err) return log('ERROR  ', 'Send Error: ', err.message); });
                    log('INFO  ', 'Energy>> Send to Device:', obj.deviceId, obj.subId, 'light/outlet', '->', obj.state, obj.commandHex.toString('hex'));
                } else if (objfilter.includes(obj.deviceId)) {
                    control485.write(obj.commandHex, (err) => { if (err) return log('ERROR  ', 'Send Error: ', err.message); });
                    log('INFO  ', 'Control>> Send to Device:', obj.deviceId, obj.subId, '->', obj.state, obj.commandHex.toString('hex'));
                } else if (objfilter2.includes(obj.deviceId)) {
                    smart2.write(obj.commandHex, (err) => { if (err) return log('ERROR  ', 'Send Error: ', err.message); });
                    log('INFO  ', 'Smart>> Send to Device:', obj.deviceId, obj.subId, '->', obj.state, obj.commandHex.toString('hex'));
                }
            }
            else if (CONST.WALLPAD_TYPE == 'old') {
                RS485.write(obj.commandHex, (err) => { if (err) return log('ERROR  ', 'Send Error: ', err.message); });
                log('INFO  ', 'RS485>> Send to Device:', obj.deviceId, obj.subId, '->', obj.state, obj.commandHex.toString('hex'));
            }
        }
    }
    if (obj.sentTime = lastReceive);
    else if (obj.sentTime2 = lastReceive2);	// 명령 전송시간 sentTime으로 저장

    // ack메시지가 오지 않는 경우 방지
    retryCnt++;
    if (typefilter.includes('serial')) {
        if (retryCnt < CONST.SERIAL_RETYRCNT) {
            // 다시 큐에 저장하여 Ack 메시지 받을때까지 반복 실행
            queue.push(obj);
        } else {
            // 보통 패킷을 수정하다가 맨 뒤에 있는 체크섬이 틀리거나 ew11 과부하 걸리는 경우(ew11 재부팅 시도)
            log('ERROR   Packet send error Please check packet or ew11 =>', obj.commandHex.toString('hex'));
            retryCnt = 0;
        }
    } else if (typefilter.includes('socket')) {
        if (retryCnt < CONST.SOCKET_RETYRCNT) {
            // 
            queue.push(obj);
        } else {
            // 
            log('ERROR   Packet send error Please check packet or ew11 =>', obj.commandHex.toString('hex'));
            retryCnt = 0;
        }
    }
};

setTimeout(() => { mqttReady = true; log('INFO   MQTT ready...') }, CONST.MQTT_DELAY);
setInterval(commandProc, 20);
