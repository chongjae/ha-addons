/**
 * RS485 Homegateway for Bestin Homenet
 * @소스 공개 : Daehwan, Kang
 * @베스틴 홈넷용으로 수정 : harwin
 * @수정일 2022-09-10
 */

const util = require('util');
const net = require('net');
var fs = require("fs");
const SerialPort = require('serialport').SerialPort;
const mqtt = require('mqtt');

const CONFIG = require('/data/options.json');

const energyVar = {
    // 타입 정의
    type: CONFIG.energy.type, //'socket' , 'serial'
    header: CONFIG.energy.header, //'Socket' , 'Serial'

    // 시리얼 설정
    rate: CONFIG.energy.serial.baudrate,
    data: CONFIG.energy.serial.bytesize,
    parity: CONFIG.energy.serial.parity,
    stop: CONFIG.energy.serial.stopbits,
    open: false,
    encoding: 'hex',
    windowPort: CONFIG.energy.serial.windowPort,
    rpiPort: CONFIG.energy.serial.rpiPort,

    // 소켓 설정
    port: CONFIG.energy.socket.port,
    addr: CONFIG.energy.socket.addr
};

const controlVar = {
    // 타입 정의
    type: CONFIG.control.type, //'socket' , 'serial'
    header: CONFIG.control.header, //'Socket' , 'Serial'

    // 시리얼 설정
    rate: CONFIG.control.serial.baudrate,
    data: CONFIG.control.serial.bytesize,
    parity: CONFIG.control.serial.parity,
    stop: CONFIG.control.serial.stopbits,
    open: false,
    encoding: 'hex',
    windowPort: CONFIG.control.serial.windowPort,
    rpiPort: CONFIG.control.serial.rpiPort,

    // 소켓 설정
    port: CONFIG.control.socket.port,
    addr: CONFIG.control.socket.addr
};

const smartVar = {
    // Bestin의 경우 rs422 방식으로 timestamp를 통한 엘리베이터 호출이므로 ew11같은 무선은 싱크가 안맞을 수 있어 유선을 권장함//
    enable: 'off',  // 'off' , 'on'(비활성화, 활성화)

    // 시리얼 설정
    rate: CONFIG.smart.baudrate,
    data: CONFIG.smart.bytesize,
    parity: CONFIG.smart.parity,
    stop: CONFIG.smart.stopbits,
    open: false,
    encoding: 'hex',

    // Recv 포트 설정
    windowPort: smart.serial_recv.windowPort,
    rpiPort: smart.serial_recv.rpiPort,
    // Send 포트 설정
    windowPort2: smart.serial_send.windowPort,
    rpiPort2: smart.serial_send.rpiPort,
};

const mqttVar = {
    broker: 'mqtt://' + CONFIG.mqtt.broker,
    port: CONFIG.mqtt.port,
    username: CONFIG.mqtt.username,
    password: CONFIG.mqtt.password,
    clientId: 'bestin_ipark',
    topic_prefix: CONFIG.mqtt.prefix,
    state_topic: CONFIG.mqtt.prefix + '/%s%s/%s/state',
    device_topic: CONFIG.mqtt.prefix + '/+/+/command'
};

// StateParser
const checkStateValue = (state, data) => {
    return data.length + 1 === state.statePrefixHex[1] &&
        state.statePrefixHex.compare(data, 0, state.statePrefixHex.length) === 0 &&
        data[state.stateIndex] === state.stateCode;
};

const CONST = {
    // 포트이름 설정
    portEN: process.platform.startsWith('win') ? energyVar.windowPort : energyVar.rpiPort,
    portCTRL: process.platform.startsWith('win') ? controlVar.windowPort : controlVar.rpiPort,
    portRecv: process.platform.startsWith('win') ? smartVar.windowPort : smartVar.rpiPort,  //RJ45(4,5)
    portSend: process.platform.startsWith('win') ? smartVar.windowPort2 : smartVar.rpiPort2,  //RJ45(7,8)
    // SerialPort 전송 Delay(ms)
    sendDelay: CONFIG.sendDelay,
    // MQTT 수신 Delay(ms)
    mqttDelay: CONFIG.receiveDelay,
    // 메시지 Prefix 상수
    MSG_PREFIX: [0x02],
    // 디바이스 Hex코드
    DEVICE_STATE: [
        { deviceId: 'Fan', subId: '', statePrefixHex: Buffer.from('026100', 'hex'), checkState: checkStateValue, stateIndex: 6, stateCode: 0x00, stateName: 'power', state: 'OFF' },
        { deviceId: 'Fan', subId: '', statePrefixHex: Buffer.from('026100', 'hex'), checkState: checkStateValue, stateIndex: 6, stateCode: 0x01, stateName: 'power', state: 'ON' },
        { deviceId: 'Fan', subId: '', statePrefixHex: Buffer.from('026100', 'hex'), checkState: checkStateValue, stateIndex: 7, stateCode: 0x01, stateName: 'preset', state: 'low' },
        { deviceId: 'Fan', subId: '', statePrefixHex: Buffer.from('026100', 'hex'), checkState: checkStateValue, stateIndex: 7, stateCode: 0x02, stateName: 'preset', state: 'medium' },
        { deviceId: 'Fan', subId: '', statePrefixHex: Buffer.from('026100', 'hex'), checkState: checkStateValue, stateIndex: 7, stateCode: 0x03, stateName: 'preset', state: 'high' },

        { deviceId: 'Thermo', subId: '1', stateHex: Buffer.alloc(16, '02281091AD01010A00F20025000000E1', 'hex'), power: 'heat', setTemp: '', curTemp: '' },
        { deviceId: 'Thermo', subId: '1', stateHex: Buffer.alloc(16, '02281091C101020A00F20025000000B8', 'hex'), power: 'off', setTemp: '', curTemp: '' },
        { deviceId: 'Thermo', subId: '2', stateHex: Buffer.alloc(16, '022810918902010500F30025000000E4', 'hex'), power: 'heat', setTemp: '', curTemp: '' },
        { deviceId: 'Thermo', subId: '2', stateHex: Buffer.alloc(16, '022810919D02020500F20025000000F0', 'hex'), power: 'off', setTemp: '', curTemp: '' },
        { deviceId: 'Thermo', subId: '3', stateHex: Buffer.alloc(16, '02281091A103010500F00025000000C6', 'hex'), power: 'heat', setTemp: '', curTemp: '' },
        { deviceId: 'Thermo', subId: '3', stateHex: Buffer.alloc(16, '02281091A103020500F00025000000C7', 'hex'), power: 'off', setTemp: '', curTemp: '' },
        { deviceId: 'Thermo', subId: '4', stateHex: Buffer.alloc(16, '022810919104010500F800250000009D', 'hex'), power: 'heat', setTemp: '', curTemp: '' },
        { deviceId: 'Thermo', subId: '4', stateHex: Buffer.alloc(16, '02281091A504020500F80025000000D4', 'hex'), power: 'off', setTemp: '', curTemp: '' },
        { deviceId: 'Thermo', subId: '5', stateHex: Buffer.alloc(16, '022810919505010500EC002500000000', 'hex'), power: 'heat', setTemp: '', curTemp: '' },
        { deviceId: 'Thermo', subId: '5', stateHex: Buffer.alloc(16, '02281091D105020500EB002500000052', 'hex'), power: 'off', setTemp: '', curTemp: '' },

        { deviceId: 'Gas', subId: '', stateHex: Buffer.alloc(10, '0231809A8000000000B5', 'hex'), power: 'OFF' },
        { deviceId: 'Gas', subId: '', stateHex: Buffer.alloc(10, '023180828001000000BC', 'hex'), power: 'ON' },
        { deviceId: 'Elevator', subId: '', stateHex: Buffer.alloc(18), floor: '' },
        { deviceId: 'Elevator', subId: '', stateHex: Buffer.alloc(18), call: 'OFF' },
        { deviceId: 'Elevator', subId: '', stateHex: Buffer.alloc(18), call: 'ON' }
    ],

    DEVICE_COMMAND: [
        { deviceId: 'Light', subId: '1', commandHex0: Buffer.alloc(13, '02310d01d701010000000000f5', 'hex'), power1: 'OFF' },
        { deviceId: 'Light', subId: '1', commandHex0: Buffer.alloc(13, '02310d01d00181000000000476', 'hex'), power1: 'ON' },
        { deviceId: 'Light', subId: '1', commandHex0: Buffer.alloc(13, '02310d015f010200000000006a', 'hex'), power2: 'OFF' },
        { deviceId: 'Light', subId: '1', commandHex0: Buffer.alloc(13, '02310d015801820000000004e9', 'hex'), power2: 'ON' },
        { deviceId: 'Light', subId: '1', commandHex0: Buffer.alloc(13, '02310d0163010400000000006c', 'hex'), power3: 'OFF' },
        { deviceId: 'Light', subId: '1', commandHex0: Buffer.alloc(13, '02310d015c01840000000004ef', 'hex'), power3: 'ON' },   //방1
        { deviceId: 'Light', subId: '2', commandHex0: Buffer.alloc(13, '02310d019302010000000000b8', 'hex'), power1: 'OFF' },
        { deviceId: 'Light', subId: '2', commandHex0: Buffer.alloc(13, '02310d018c028100000000043f', 'hex'), power1: 'ON' },
        { deviceId: 'Light', subId: '2', commandHex0: Buffer.alloc(13, '02310d018402020000000000c4', 'hex'), power2: 'OFF' },
        { deviceId: 'Light', subId: '2', commandHex0: Buffer.alloc(13, '02310d017b02820000000004cb', 'hex'), power2: 'ON' },   //방2
        { deviceId: 'Light', subId: '3', commandHex0: Buffer.alloc(13, '02310d0143030100000000008b', 'hex'), power1: 'OFF' },
        { deviceId: 'Light', subId: '3', commandHex0: Buffer.alloc(13, '02310d013b0381000000000497', 'hex'), power1: 'ON' },
        { deviceId: 'Light', subId: '3', commandHex0: Buffer.alloc(13, '02310d017e0302000000000049', 'hex'), power2: 'OFF' },
        { deviceId: 'Light', subId: '3', commandHex0: Buffer.alloc(13, '02310d017603820000000004d5', 'hex'), power2: 'ON' },   //방3
        { deviceId: 'Light', subId: '4', commandHex0: Buffer.alloc(13, '02310d01c40401000000000005', 'hex'), power1: 'OFF' },
        { deviceId: 'Light', subId: '4', commandHex0: Buffer.alloc(13, '02310d0191048100000000042c', 'hex'), power1: 'ON' },
        { deviceId: 'Light', subId: '4', commandHex0: Buffer.alloc(13, '02310d0103040200000000004d', 'hex'), power2: 'OFF' },
        { deviceId: 'Light', subId: '4', commandHex0: Buffer.alloc(13, '02310d01fe048200000000044c', 'hex'), power2: 'ON' },   //방4
        { deviceId: 'Light', subId: '5', commandHex0: Buffer.alloc(13, '02310d017f0501000000000049', 'hex'), power1: 'OFF' },
        { deviceId: 'Light', subId: '5', commandHex0: Buffer.alloc(13, '02310d017005810000000004ca', 'hex'), power1: 'ON' },
        { deviceId: 'Light', subId: '5', commandHex0: Buffer.alloc(13, '02310d018a05020000000000b7', 'hex'), power2: 'OFF' },
        { deviceId: 'Light', subId: '5', commandHex0: Buffer.alloc(13, '02310d01840582000000000441', 'hex'), power2: 'ON' },   //방5

        { deviceId: 'Outlet', subId: '1', commandHex0: Buffer.alloc(13, '02310D01D801000100000000EC', 'hex'), power1: 'OFF' },
        { deviceId: 'Outlet', subId: '1', commandHex0: Buffer.alloc(13, '02310D01FC010081000000094F', 'hex'), power1: 'ON' },
        { deviceId: 'Outlet', subId: '1', commandHex0: Buffer.alloc(13, '02310D010A010002000000003F', 'hex'), power2: 'OFF' },
        { deviceId: 'Outlet', subId: '1', commandHex0: Buffer.alloc(13, '02310D01D50100820000001262', 'hex'), power2: 'ON' },   //방1
        { deviceId: 'Outlet', subId: '2', commandHex0: Buffer.alloc(13, '02310D01050200010000000040', 'hex'), power1: 'OFF' },
        { deviceId: 'Outlet', subId: '2', commandHex0: Buffer.alloc(13, '02310D01B30200810000000911', 'hex'), power1: 'ON' },
        { deviceId: 'Outlet', subId: '2', commandHex0: Buffer.alloc(13, '02310D018102000200000000C1', 'hex'), power2: 'OFF' },
        { deviceId: 'Outlet', subId: '2', commandHex0: Buffer.alloc(13, '02310D016502008200000012CF', 'hex'), power2: 'ON' },   //방2
        { deviceId: 'Outlet', subId: '3', commandHex0: Buffer.alloc(13, '02310D01440300010000000082', 'hex'), power1: 'OFF' },
        { deviceId: 'Outlet', subId: '3', commandHex0: Buffer.alloc(13, '02310D01B1030081000000091C', 'hex'), power1: 'ON' },
        { deviceId: 'Outlet', subId: '3', commandHex0: Buffer.alloc(13, '02310D016E0300020000000055', 'hex'), power2: 'OFF' },
        { deviceId: 'Outlet', subId: '3', commandHex0: Buffer.alloc(13, '02310D01E8030082000000124D', 'hex'), power2: 'ON' },   //방3
        { deviceId: 'Outlet', subId: '4', commandHex0: Buffer.alloc(13, '02310D01220400010000000021', 'hex'), power1: 'OFF' },
        { deviceId: 'Outlet', subId: '4', commandHex0: Buffer.alloc(13, '02310D011A04008100000009A2', 'hex'), power1: 'ON' },
        { deviceId: 'Outlet', subId: '4', commandHex0: Buffer.alloc(13, '02310D011B0400020000000031', 'hex'), power2: 'OFF' },
        { deviceId: 'Outlet', subId: '4', commandHex0: Buffer.alloc(13, '02310D011304008200000012AB', 'hex'), power2: 'ON' },   //방4
        { deviceId: 'Outlet', subId: '5', commandHex0: Buffer.alloc(13, '02310D01D805000100000000E8', 'hex'), power1: 'OFF' },
        { deviceId: 'Outlet', subId: '5', commandHex0: Buffer.alloc(13, '02310D01D4050081000000097B', 'hex'), power1: 'ON' },
        { deviceId: 'Outlet', subId: '5', commandHex0: Buffer.alloc(13, '02310D01E205000200000000E3', 'hex'), power2: 'OFF' },
        { deviceId: 'Outlet', subId: '5', commandHex0: Buffer.alloc(13, '02310D01E60500820000001275', 'hex'), power2: 'ON' },   //방5

        { deviceId: 'Fan', subId: '', commandHex1: Buffer.alloc(10, '0261014c00000100002f', 'hex'), power: 'OFF' }, //꺼짐
        { deviceId: 'Fan', subId: '', commandHex1: Buffer.alloc(10, '026101e3000101000089', 'hex'), power: 'ON' }, //켜짐
        { deviceId: 'Fan', subId: '', commandHex1: Buffer.alloc(10, '0261071200100000006C', 'hex'), preset: 'nature OFF' }, //자연환기(꺼짐)
        { deviceId: 'Fan', subId: '', commandHex1: Buffer.alloc(10, '0261071200100000006C', 'hex'), preset: 'nature ON' }, //자연환기(켜짐)
        { deviceId: 'Fan', subId: '', commandHex1: Buffer.alloc(10, '026103eb00000100008a', 'hex'), preset: 'low' }, //약(켜짐)
        { deviceId: 'Fan', subId: '', commandHex1: Buffer.alloc(10, '02610394000002000000', 'hex'), preset: 'medium' }, //중(켜짐)
        { deviceId: 'Fan', subId: '', commandHex1: Buffer.alloc(10, '0261039f0000030000fc', 'hex'), preset: 'high' }, //강(켜짐)

        { deviceId: 'Thermo', subId: '1', commandHex1: Buffer.alloc(14, '02280e12e90101000000000000e3', 'hex'), power: 'heat' }, // 온도조절기1-on
        { deviceId: 'Thermo', subId: '1', commandHex1: Buffer.alloc(14, '02280e12f70102000000000000c8', 'hex'), power: 'off' }, // 온도조절기1-off
        { deviceId: 'Thermo', subId: '2', commandHex1: Buffer.alloc(14, '02280e12d30201000000000000ee', 'hex'), power: 'heat' },
        { deviceId: 'Thermo', subId: '2', commandHex1: Buffer.alloc(14, '02280e12dd0202000000000000f5', 'hex'), power: 'off' },
        { deviceId: 'Thermo', subId: '3', commandHex1: Buffer.alloc(14, '02280e127e030100000000000058', 'hex'), power: 'heat' },
        { deviceId: 'Thermo', subId: '3', commandHex1: Buffer.alloc(14, '02280e12870302000000000000ba', 'hex'), power: 'off' },
        { deviceId: 'Thermo', subId: '4', commandHex1: Buffer.alloc(14, '02280e12b8040100000000000091', 'hex'), power: 'heat' },
        { deviceId: 'Thermo', subId: '4', commandHex1: Buffer.alloc(14, '02280e12c10402000000000000f7', 'hex'), power: 'off' },
        { deviceId: 'Thermo', subId: '5', commandHex1: Buffer.alloc(14, '02280e12cc050100000000000008', 'hex'), power: 'heat' },
        { deviceId: 'Thermo', subId: '5', commandHex1: Buffer.alloc(14, '02280e12be05020000000000008f', 'hex'), power: 'off' },
        { deviceId: 'Thermo', subId: '1', commandHex1: Buffer.alloc(14, '', 'hex'), setTemp: '' }, // 온도조절기1-온도설정
        { deviceId: 'Thermo', subId: '2', commandHex1: Buffer.alloc(14, '', 'hex'), setTemp: '' },
        { deviceId: 'Thermo', subId: '3', commandHex1: Buffer.alloc(14, '', 'hex'), setTemp: '' },
        { deviceId: 'Thermo', subId: '4', commandHex1: Buffer.alloc(14, '', 'hex'), setTemp: '' },
        { deviceId: 'Thermo', subId: '5', commandHex1: Buffer.alloc(14, '', 'hex'), setTemp: '' },

        { deviceId: 'Gas', subId: '', commandHex1: Buffer.alloc(10, '0231023c000000000011', 'hex'), power: 'OFF' },
        //{ deviceId: 'Elevator', subId: '', commandHex2: Buffer.from(bytes), call: 'ON' }
    ],

    // 상태 Topic (/homenet/${deviceId}${subId}/${property}/state/ = ${value})
    // 명령어 Topic (/homenet/${deviceId}${subId}/${property}/command/ = ${value})
    TOPIC_PRFIX: mqttVar.topic_prefix,
    STATE_TOPIC: mqttVar.state_topic,  //상태 전달
    DEVICE_TOPIC: mqttVar.device_topic //명령 수신
};

// 베스틴 홈넷용 시리얼 통신 파서 : 메시지 길이나 구분자가 불규칙하여 별도 파서 정의
var Transform = require('stream').Transform;
util.inherits(CustomParser, Transform);

function CustomParser(options) {
    if (!(this instanceof CustomParser))
        return new CustomParser(options);
    Transform.call(this, options);
    this._queueChunk = [];
    this._msgLenCount = 0;
    this._msgLength = 30;
    this._msgTypeFlag = false;
}

CustomParser.prototype._transform = function (chunk, encoding, done) {
    var start = 0;
    for (var i = 0; i < chunk.length; i++) {
        if (CONST.MSG_PREFIX.includes(chunk[i])) {			// 청크에 구분자(MSG_PREFIX)가 있으면
            this._queueChunk.push(chunk.slice(start, i));	// 구분자 앞부분을 큐에 저장하고
            this.push(Buffer.concat(this._queueChunk));	// 큐에 저장된 메시지들 합쳐서 내보냄
            this._queueChunk = [];	// 큐 초기화
            this._msgLenCount = 0;
            start = i;
            this._msgTypeFlag = true;	// 다음 바이트는 메시지 종류
        }
        // 메시지 종류에 따른 메시지 길이 파악
        else if (this._msgTypeFlag) {
            switch (chunk[i]) {
                case 0x28: case 0x0e:  //난방(command)
                    this._msgLength = 14; break;
                case 0x10: case 0x28:  //난방(ack)
                    this._msgLength = 16; break;
                case 0x61: case 0x80: case 0x81: case 0x87: case 0x83: case 0x01: case 0x03: case 0x07:  //환기(command, ack)
                    this._msgLength = 10; break;
                case 0x10: case 0x31: case 0x82:  //가스벨브(command, ack)
                    this._msgLength = 10; break;
                case 0x31: case 0x81: case 0x91: case 0x1e:  //조명,콘센트(ack)
                    this._msgLength = 30; break;
                case 0x31: case 0x0d:  //조명,콘센트(command)
                    this._msgLength = 13; break;
                default:
                    this._msgLength = 30;
            }
            this._msgTypeFlag = false;
        }
        this._msgLenCount++;
    }
    // 구분자가 없거나 구분자 뒷부분 남은 메시지 큐에 저장
    this._queueChunk.push(chunk.slice(start));

    // 메시지 길이를 확인하여 다 받았으면 내보냄
    if (this._msgLenCount >= this._msgLength) {
        this.push(Buffer.concat(this._queueChunk));	// 큐에 저장된 메시지들 합쳐서 내보냄
        this._queueChunk = [];	// 큐 초기화
        this._msgLenCount = 0;
    }

    done();
};

// 로그 표시 
var log = (...args) => console.log('[' + new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) + ']', args.join(' '));

// 홈컨트롤 상태
var homeStatus = {};
var lastReceive = new Date().getTime();
var mqttReady = false;
var queue = new Array();
var queueSent = new Array();

// MQTT-Broker 연결 
log("[INFO] Initializing mqtt...");
const client = mqtt.connect(mqttVar.broker, {
    port: mqttVar.port,
    username: mqttVar.username,
    password: mqttVar.password,
    clientId: mqttVar.clientId,
});
client.on('connect', () => {
    log("[MQTT] Connection successful!");
    client.subscribe(CONST.DEVICE_TOPIC, (err) => { if (err) log('[Error] Mqtt subscribe fail! -', CONST.DEVICE_TOPIC) });
});
client.on('error', err => {
    log("[Error] Mqtt error occurred: " + err);
    if (err.code == "ENOTFOUND") {
        console.log("Network error, make sure mqtt broker is enabled")
    }
});
client.on("offline", () => {
    log("[MQTT] Currently offline. Please check mqtt broker!");
});
client.on("reconnect", () => {
    log("[MQTT] Reconnection starting...");
});

// Energy
if (energyVar.header == 'Serial') {

    log('[INFO] Initializing:' + energyVar.header);
    energy485 = new SerialPort({
        path: CONST.portEN,
        baudRate: energyVar.rate,
        dataBits: energyVar.data,
        parity: energyVar.parity,
        stopBits: energyVar.stop,
        autoOpen: energyVar.open,
        encoding: energyVar.encoding
    });
    energy = energy485.pipe(new CustomParser());
    energy485.on('open', () => log('[Serial] Success open energy port:', CONST.portEN));
    energy485.on('close', () => log('[Serial] Close energy port:', CONST.portEN));
    energy485.open((err) => {
        if (err) {
            return log('[Error] Serial opening energy port:', err.message);
        }
    });
}
else {
    energy485 = new net.Socket();
    energy485.connect(energyVar.port, energyVar.addr, function () {
        log('[Socket] Success connected to energy', "(" + energyVar.addr + ")");
    });
    energy = energy485.pipe(new CustomParser());
};

// Control 
if (controlVar.header == 'Serial') {

    log('[INFO] Initializing:' + controlVar.header);
    control485 = new SerialPort({
        path: CONST.portCTRL,
        baudRate: controlVar.rate,
        dataBits: controlVar.data,
        parity: controlVar.parity,
        stopBits: controlVar.stop,
        autoOpen: controlVar.open,
        encoding: controlVar.encoding
    });
    control = control485.pipe(new CustomParser());
    control485.on('open', () => log('[Serial] Success open control port:', CONST.portCTRL));
    control485.on('close', () => log('[Serial] Close control port:', CONST.portCTRL));
    control485.open((err) => {
        if (err) {
            return log('[Error] Serial opening control port:', err.message);
        }
    });
}
else {
    control485 = new net.Socket();
    control485.connect(controlVar.port, controlVar.addr, function () {
        log('[Socket] Success connected to control', "(" + controlVar.addr + ")");
    });
    control = control485.pipe(new CustomParser());
};

// Smart
if (smartVar.enable == 'on') {

    log('[INFO] Initializing serial...');
    port1 = new SerialPort({
        path: CONST.portRecv,
        baudRate: smartVar.rate,
        dataBits: smartVar.data,
        parity: smartVar.parity,
        stopBits: smartVar.stop,
        autoOpen: smartVar.open,
        encoding: smartVar.encoding
    });
    port1.on('open', () => log('[Serial] Success open smart1 port:', CONST.portRecv));
    port1.on('close', () => log('[Serial] Close smart1 port:', CONST.portRecv));
    port1.open((err) => {
        if (err) {
            return log('[Error] Serial opening smart1 port:', err.message);
        }
    });

    port2 = new SerialPort({
        path: CONST.portSend,
        baudRate: smartVar.rate,
        dataBits: smartVar.data,
        parity: smartVar.parity,
        stopBits: smartVar.stop,
        autoOpen: smartVar.open,
        encoding: smartVar.encoding
    });
    port2.on('open', () => log('[Serial] Success open smart2 port:', CONST.portSend));
    port2.on('close', () => log('[Serial] Close smart2 port:', CONST.portSend));
    port2.open((err) => {
        if (err) {
            return log('[Error] Serial opening smart2 port:', err.message);
        }
    });
};

// Checksum
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
        sum = sum + data[i];
    }
    sum = (sum + 1) & 0xff;
    return sum;
}

// Timestamp
fs.readFile('./timestamp.txt', function (err, data) {
    if (err) {
        log('[Error] File error', err)
    } else {
        log('[INFO] Success file open')
    }
    var buf = data.toString().split('\n');
    for (i in buf) {
        //console.log(buf[i]);
    }
});

// 홈넷에서 SerialPort로 상태 정보 수신
energy.on('data', function (data) {
    lastReceive = new Date().getTime();

    receive_check = true; // CheckSum(data, 12);
    if (receive_check != true || (data[0] != 0x02)) {
        log('[Error] error checksum:', receive_check);
        return;
    }
    if (data[0] != 0x02) {
        log('[Error] error stx:', data.toString('hex', 0, 1), data.toString('hex', 1));
        return;
    }

    if (data[2] == 0x1e) {
        //var stateFound = CONST.DEVICE_STATE.filter(obj => obj.checkState(obj, data));
        //if (stateFound.length !== 0) {
        //stateFound.forEach(function (obj) {
        //    updateStatus(obj);
        //  });
        //}
    }
    // 딜레이
    commandProc();

    if (data[3] == 0x81) {     //조명 및 콘센트 전원 '명령응답'
        const ack = Buffer.alloc(1);
        data.copy(ack, 0, 1, 3);
        var objFoundIdx = queue.findIndex(obj => obj.commandHex0?.includes(ack));
        if (objFoundIdx > -1) {
            log("[" + energyVar.header + "]", 'Success command:', data.toString('hex'));
            queue.splice(objFoundIdx, 1);
        }
    }
});

control.on('data', function (data) {
    lastReceive = new Date().getTime();

    //var receive_check = CheckSum(data);
    //if (receive_check != true || (data[0] != 0x02)) {
    //  log('[Error] Packet Error(Checksum):', receive_check);
    //return;
    //}
    if (data[0] != 0x02) {
        log('[Error] error stx:', data.toString('hex', 0, 1), data.toString('hex', 1));
        return;
    }

    switch (data[1]) {
        case 0x31: case 0x61: case 0x28: //가스, 전열교환기, 난방
        //var stateFound = CONST.DEVICE_STATE.filter(obj => obj.checkState(obj, data));
        //if (stateFound.length !== 0) {
        //  stateFound.forEach(function (obj) {
        //    updateStatus(obj);
        //});
        //}
    }
    // 딜레이
    commandProc();

    switch (data[2]) {
        case 0x10: case 0x81: case 0x82: case 0x83: case 0x87: //난방, 환기, 가스 '명령응답'
            const ack2 = Buffer.alloc(1);
            data.copy(ack2, 0, 1, 2);
            var objFoundIdx = queue.findIndex(obj => obj.commandHex1?.includes(ack2));
            if (objFoundIdx > -1) {
                log("[" + controlVar.header + "]", 'Success command:', data.toString('hex'));
                queue.splice(objFoundIdx, 1);
            }
    }
});

if (smartVar.enable == 'on') {
    port1.on('data', function (data) {
        lastReceive = new Date().getTime();

        if (data[11] == 0x01) {
            const Elv = Buffer.alloc(1);
            data.copy(Elv, 0, 1, 11);
            var objFoundIdx = queue.findIndex(obj => obj.commandHex2?.includes(Elv));
            if (objFoundIdx > -1) {
                log('[Serial]', 'Success command:', data.toString('hex'));
                queue.splice(objFoundIdx, 1);
            }
            return;
        }
    });
};

// MQTT로 HA에 상태값 전송
var updateStatus = (obj) => {
    var arrStateName = Object.keys(obj);
    // 상태값이 아닌 항목들은 제외 [deviceId, subId, stateHex, commandHex, sentTime]
    const arrFilter = ['deviceId', 'subId', 'stateHex', 'commandHex0', 'commandHex1', 'commandHex2', 'sentTime'];
    arrStateName = arrStateName.filter(stateName => !arrFilter.includes(stateName));

    // 상태값별 현재 상태 파악하여 변경되었으면 상태 반영 (MQTT publish)
    arrStateName.forEach(function (stateName) {
        // 상태값이 없거나 상태가 같으면 반영 중지
        var curStatus = homeStatus[obj.deviceId + obj.subId + stateName];
        if (obj[stateName] == null || obj[stateName] === curStatus) return;
        // 미리 상태 반영한 device의 상태 원복 방지
        if (queue.length > 0) {
            var found = queue.find(q => q.deviceId + q.subId === obj.deviceId + obj.subId && q[stateName] === curStatus);
            if (found != null) return;
        }
        // 상태 반영 (MQTT publish)
        homeStatus[obj.deviceId + obj.subId + stateName] = obj[stateName];
        var topic = util.format(CONST.STATE_TOPIC, obj.deviceId, obj.subId, stateName);
        client.publish(topic, obj[stateName], { retain: true });
        log('[MQTT] Send to HA:', topic, '->', obj[stateName]);
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
                objFound = CONST.DEVICE_COMMAND.find(obj => obj.deviceId + obj.subId === topics[1] && obj.hasOwnProperty('setTemp'));
                objFound.commandHex1[3] = Number(value);
                objFound.setTemp = String(Number(value)); // 온도값은 소수점이하는 버림
                var xorSum = objFound.commandHex1[0] ^ objFound.commandHex1[1] ^ objFound.commandHex1[2] ^ objFound.commandHex1[3] ^ 0x00
                objFound.commandHex1[7] = xorSum; // 마지막 Byte는 XOR SUM
            }
            // 다른 명령은 미리 정의해놓은 값을 매칭
            else {
                objFound = CONST.DEVICE_COMMAND.find(obj => obj.deviceId + obj.subId === topics[1] && obj[topics[2]] === value);
            }
        }

        if (objFound == null) {
            log('[MQTT] Receive Unknown Msg.: ', topic, ':', value);
            return;
        }

        // 현재 상태와 같으면 Skip
        if (value === homeStatus[objFound.deviceId + objFound.subId + objFound[topics[2]]]) {
            log('[MQTT] Receive & Skip: ', topic, ':', value);
        }
        // Serial메시지 제어명령 전송 & MQTT로 상태정보 전송
        else {
            log('[MQTT] Receive from HA:', topic, ':', value);
            // 최초 실행시 딜레이 없도록 sentTime을 현재시간 보다 sendDelay만큼 이전으로 설정
            objFound.sentTime = (new Date().getTime()) - CONST.sendDelay;
            queue.push(objFound);   // 실행 큐에 저장
            updateStatus(objFound); // 처리시간의 Delay때문에 미리 상태 반영
        }
    }
});

// SerialPort로 제어 명령 전송
const commandProc = () => {
    // 큐에 처리할 메시지가 없으면 종료
    if (queue.length == 0) return;

    // 기존 홈넷 RS485 메시지와 충돌하지 않도록 Delay를 줌
    var delay = (new Date().getTime()) - lastReceive;
    if (delay < CONST.sendDelay) return;

    // 큐에서 제어 메시지 가져오기
    var obj = queue.shift();
    if (obj.commandHex0) {
        energy485.write(obj.commandHex0, (err) => { if (err) return log("[" + energyVar.header + "]", 'Send Error: ', err.message); });
        log("[" + energyVar.header + "]", 'Send to Device:', obj.deviceId, obj.subId, '->', obj.state, '(' + delay + 'ms) ', obj.commandHex0.toString('hex'));
    } else if (obj.commandHex1) {
        control485.write(obj.commandHex1, (err) => { if (err) return log("[" + controlVar.header + "]", 'Send Error: ', err.message); });
        log("[" + controlVar.header + "]", 'Send to Device:', obj.deviceId, obj.subId, '->', obj.state, '(' + delay + 'ms) ', obj.commandHex1.toString('hex'));
    } else {
        port2.write(obj.commandHex2, (err) => { if (err) return log('[Serial] Send Error: ', err.message); });
        log('[Serial] Send to Device:', obj.deviceId, obj.subId, '->', obj.state, '(' + delay + 'ms) ', obj.commandHex2.toString());
    }
    lastReceive = new Date().getTime();
    obj.sentTime = lastReceive;	// 명령 전송시간 sentTime으로 저장
    // 다시 큐에 저장하여 Ack 메시지 받을때까지 반복 실행
    queue.push(obj);
};

setTimeout(() => { mqttReady = true; log('[INFO] Mqtt ready...') }, CONST.mqttDelay);
setInterval(commandProc, 20);

