/**
 * RS485 Homegateway for Bestin Homenet
 * @소스 공개 : Daehwan, Kang
 * @베스틴 홈넷용으로 수정 : harwin
 * @수정일 2022-09-10
 */

const util = require('util');
const net = require('net');
const SerialPort = require('serialport').SerialPort;
const mqtt = require('mqtt');

const CONFIG = require('/data/options.json');

const energyVar = {
    // 타입 정의
    type: CONFIG.energy_type, //'socket' , 'serial'
    //시리얼 설정
    windowPort: CONFIG.serial.energy_windowPort,
    rpiPort: CONFIG.serial.energy_rpiPort,
    // 소켓 설정
    port: CONFIG.socket.energy_port,
    addr: CONFIG.socket.energy_addr
};

const controlVar = {
    // 타입 정의
    type: CONFIG.ctrl_type, //'socket' , 'serial'
    // 시리얼 설정
    windowPort: CONFIG.serial.ctrl_windowPort,
    rpiPort: CONFIG.serial.ctrl_rpiPort,
    // 소켓 설정
    port: CONFIG.socket.ctrl_port,
    addr: CONFIG.socket.ctrl_addr
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

const CONST = {
    // 포트이름 설정
    portEN: process.platform.startsWith('win') ? energyVar.windowPort : energyVar.rpiPort,
    portCTRL: process.platform.startsWith('win') ? controlVar.windowPort : controlVar.rpiPort,
    // SerialPort Delay(ms)
    sendDelay: CONFIG.sendDelay,  //실제 명령 패킷전송 딜레이
    gapDelay: CONFIG.gapDelay,  //명령 전송후 ack메세지 검사 딜레이
    // MQTT 수신 Delay(ms)
    mqttDelay: CONFIG.receiveDelay,
    // 메시지 Prefix 상수
    MSG_PREFIX: [0x02],
    // 디바이스 Hex코드
    DEVICE_STATE: [
        { deviceId: 'Light', subId: '1', stateHex: Buffer.alloc(2, 'E1B7', 'hex'), power1: 'ON', power2: 'ON', power3: 'ON' },
        { deviceId: 'Light', subId: '1', stateHex: Buffer.alloc(2, 'E1B4', 'hex'), power1: 'OFF', power2: 'OFF', power3: 'ON' },
        { deviceId: 'Light', subId: '1', stateHex: Buffer.alloc(2, 'E1B3', 'hex'), power1: 'OFF', power2: 'ON', power3: 'OFF' },
        { deviceId: 'Light', subId: '1', stateHex: Buffer.alloc(2, 'E1B1', 'hex'), power1: 'ON', power2: 'OFF', power3: 'OFF' },
        { deviceId: 'Light', subId: '1', stateHex: Buffer.alloc(2, 'E1B0', 'hex'), power1: 'OFF', power2: 'OFF', power3: 'OFF' },
        { deviceId: 'Light', subId: '2', stateHex: Buffer.alloc(2, 'E223', 'hex'), power1: 'ON', power2: 'ON' },
        { deviceId: 'Light', subId: '2', stateHex: Buffer.alloc(2, 'E220', 'hex'), power1: 'OFF', power2: 'OFF' },
        { deviceId: 'Light', subId: '2', stateHex: Buffer.alloc(2, 'E222', 'hex'), power1: 'OFF', power2: 'ON' },
        { deviceId: 'Light', subId: '2', stateHex: Buffer.alloc(2, 'E221', 'hex'), power1: 'ON', power2: 'OFF' },
        { deviceId: 'Light', subId: '3', stateHex: Buffer.alloc(2, 'E323', 'hex'), power1: 'ON', power2: 'ON' },
        { deviceId: 'Light', subId: '3', stateHex: Buffer.alloc(2, 'E320', 'hex'), power1: 'OFF', power2: 'OFF' },
        { deviceId: 'Light', subId: '3', stateHex: Buffer.alloc(2, 'E322', 'hex'), power1: 'OFF', power2: 'ON' },
        { deviceId: 'Light', subId: '3', stateHex: Buffer.alloc(2, 'E321', 'hex'), power1: 'ON', power2: 'OFF' },
        { deviceId: 'Light', subId: '4', stateHex: Buffer.alloc(2, 'E423', 'hex'), power1: 'ON', power2: 'ON' },
        { deviceId: 'Light', subId: '4', stateHex: Buffer.alloc(2, 'E420', 'hex'), power1: 'OFF', power2: 'OFF' },
        { deviceId: 'Light', subId: '4', stateHex: Buffer.alloc(2, 'E422', 'hex'), power1: 'OFF', power2: 'ON' },
        { deviceId: 'Light', subId: '4', stateHex: Buffer.alloc(2, 'E421', 'hex'), power1: 'ON', power2: 'OFF' },
        { deviceId: 'Light', subId: '5', stateHex: Buffer.alloc(2, 'E523', 'hex'), power1: 'ON', power2: 'ON' },
        { deviceId: 'Light', subId: '5', stateHex: Buffer.alloc(2, 'E520', 'hex'), power1: 'OFF', power2: 'OFF' },
        { deviceId: 'Light', subId: '5', stateHex: Buffer.alloc(2, 'E522', 'hex'), power1: 'OFF', power2: 'ON' },
        { deviceId: 'Light', subId: '5', stateHex: Buffer.alloc(2, 'E521', 'hex'), power1: 'ON', power2: 'OFF' },

        { deviceId: 'Fan', subId: '', stateHex: Buffer.alloc(3, '000001', 'hex'), power: 'OFF', preset: 'low' },
        { deviceId: 'Fan', subId: '', stateHex: Buffer.alloc(3, '000101', 'hex'), power: 'ON', preset: 'low' },
        { deviceId: 'Fan', subId: '', stateHex: Buffer.alloc(3, '000102', 'hex'), power: 'ON', preset: 'medium' },
        { deviceId: 'Fan', subId: '', stateHex: Buffer.alloc(3, '000103', 'hex'), power: 'ON', preset: 'high' },
        //{ deviceId: 'Fan', subId: '', stateHex: Buffer.alloc(2, '0001', 'hex'), power: 'ON', preset: 'nature OFF' },
        //{ deviceId: 'Fan', subId: '', stateHex: Buffer.alloc(2, '0011', 'hex'), power: 'ON', preset: 'nature ON' },

        { deviceId: 'Gas', subId: '', stateHex: Buffer.alloc(3, '800000', 'hex'), power: 'OFF' },
        { deviceId: 'Gas', subId: '', stateHex: Buffer.alloc(3, '800100', 'hex'), power: 'ON' },

        { deviceId: 'Thermo', subId: '1', stateHex: Buffer.alloc(2, '0102', 'hex'), power: 'OFF', setTemp: '', curTemp: '' },
        { deviceId: 'Thermo', subId: '1', stateHex: Buffer.alloc(2, '0111', 'hex'), power: 'heat', setTemp: '', curTemp: '' },
        { deviceId: 'Thermo', subId: '2', stateHex: Buffer.alloc(2, '0202', 'hex'), power: 'OFF', setTemp: '', curTemp: '' },
        { deviceId: 'Thermo', subId: '2', stateHex: Buffer.alloc(2, '0211', 'hex'), power: 'heat', setTemp: '', curTemp: '' },
        { deviceId: 'Thermo', subId: '3', stateHex: Buffer.alloc(2, '0302', 'hex'), power: 'OFF', setTemp: '', curTemp: '' },
        { deviceId: 'Thermo', subId: '3', stateHex: Buffer.alloc(2, '0311', 'hex'), power: 'heat', setTemp: '', curTemp: '' },
        { deviceId: 'Thermo', subId: '4', stateHex: Buffer.alloc(2, '0402', 'hex'), power: 'OFF', setTemp: '', curTemp: '' },
        { deviceId: 'Thermo', subId: '4', stateHex: Buffer.alloc(2, '0411', 'hex'), power: 'heat', setTemp: '', curTemp: '' },
        { deviceId: 'Thermo', subId: '5', stateHex: Buffer.alloc(2, '0502', 'hex'), power: 'OFF', setTemp: '', curTemp: '' },
        { deviceId: 'Thermo', subId: '5', stateHex: Buffer.alloc(2, '0511', 'hex'), power: 'heat', setTemp: '', curTemp: '' }
    ],

    DEVICE_COMMAND: [
        { deviceId: 'Light', subId: '1', commandHex: Buffer.alloc(13, '02310d01d701010000000000f5', 'hex'), power1: 'OFF' },
        { deviceId: 'Light', subId: '1', commandHex: Buffer.alloc(13, '02310d01d00181000000000476', 'hex'), power1: 'ON' },
        { deviceId: 'Light', subId: '1', commandHex: Buffer.alloc(13, '02310d015f010200000000006a', 'hex'), power2: 'OFF' },
        { deviceId: 'Light', subId: '1', commandHex: Buffer.alloc(13, '02310d015801820000000004e9', 'hex'), power2: 'ON' },
        { deviceId: 'Light', subId: '1', commandHex: Buffer.alloc(13, '02310d0163010400000000006c', 'hex'), power3: 'OFF' },
        { deviceId: 'Light', subId: '1', commandHex: Buffer.alloc(13, '02310d015c01840000000004ef', 'hex'), power3: 'ON' },   //방1
        { deviceId: 'Light', subId: '2', commandHex: Buffer.alloc(13, '02310d019302010000000000b8', 'hex'), power1: 'OFF' },
        { deviceId: 'Light', subId: '2', commandHex: Buffer.alloc(13, '02310d018c028100000000043f', 'hex'), power1: 'ON' },
        { deviceId: 'Light', subId: '2', commandHex: Buffer.alloc(13, '02310d018402020000000000c4', 'hex'), power2: 'OFF' },
        { deviceId: 'Light', subId: '2', commandHex: Buffer.alloc(13, '02310d017b02820000000004cb', 'hex'), power2: 'ON' },   //방2
        { deviceId: 'Light', subId: '3', commandHex: Buffer.alloc(13, '02310d0143030100000000008b', 'hex'), power1: 'OFF' },
        { deviceId: 'Light', subId: '3', commandHex: Buffer.alloc(13, '02310d013b0381000000000497', 'hex'), power1: 'ON' },
        { deviceId: 'Light', subId: '3', commandHex: Buffer.alloc(13, '02310d017e0302000000000049', 'hex'), power2: 'OFF' },
        { deviceId: 'Light', subId: '3', commandHex: Buffer.alloc(13, '02310d017603820000000004d5', 'hex'), power2: 'ON' },   //방3
        { deviceId: 'Light', subId: '4', commandHex: Buffer.alloc(13, '02310d01c40401000000000005', 'hex'), power1: 'OFF' },
        { deviceId: 'Light', subId: '4', commandHex: Buffer.alloc(13, '02310d0191048100000000042c', 'hex'), power1: 'ON' },
        { deviceId: 'Light', subId: '4', commandHex: Buffer.alloc(13, '02310d0103040200000000004d', 'hex'), power2: 'OFF' },
        { deviceId: 'Light', subId: '4', commandHex: Buffer.alloc(13, '02310d01fe048200000000044c', 'hex'), power2: 'ON' },   //방4
        { deviceId: 'Light', subId: '5', commandHex: Buffer.alloc(13, '02310d017f0501000000000049', 'hex'), power1: 'OFF' },
        { deviceId: 'Light', subId: '5', commandHex: Buffer.alloc(13, '02310d017005810000000004ca', 'hex'), power1: 'ON' },
        { deviceId: 'Light', subId: '5', commandHex: Buffer.alloc(13, '02310d018a05020000000000b7', 'hex'), power2: 'OFF' },
        { deviceId: 'Light', subId: '5', commandHex: Buffer.alloc(13, '02310d01840582000000000441', 'hex'), power2: 'ON' },   //방5

        { deviceId: 'Outlet', subId: '1', commandHex: Buffer.alloc(13, '02310D01D801000100000000EC', 'hex'), power1: 'OFF' },
        { deviceId: 'Outlet', subId: '1', commandHex: Buffer.alloc(13, '02310D01FC010081000000094F', 'hex'), power1: 'ON' },
        { deviceId: 'Outlet', subId: '1', commandHex: Buffer.alloc(13, '02310D010A010002000000003F', 'hex'), power2: 'OFF' },
        { deviceId: 'Outlet', subId: '1', commandHex: Buffer.alloc(13, '02310D01D50100820000001262', 'hex'), power2: 'ON' },   //방1
        { deviceId: 'Outlet', subId: '2', commandHex: Buffer.alloc(13, '02310D01050200010000000040', 'hex'), power1: 'OFF' },
        { deviceId: 'Outlet', subId: '2', commandHex: Buffer.alloc(13, '02310D01B30200810000000911', 'hex'), power1: 'ON' },
        { deviceId: 'Outlet', subId: '2', commandHex: Buffer.alloc(13, '02310D018102000200000000C1', 'hex'), power2: 'OFF' },
        { deviceId: 'Outlet', subId: '2', commandHex: Buffer.alloc(13, '02310D016502008200000012CF', 'hex'), power2: 'ON' },   //방2
        { deviceId: 'Outlet', subId: '3', commandHex: Buffer.alloc(13, '02310D01440300010000000082', 'hex'), power1: 'OFF' },
        { deviceId: 'Outlet', subId: '3', commandHex: Buffer.alloc(13, '02310D01B1030081000000091C', 'hex'), power1: 'ON' },
        { deviceId: 'Outlet', subId: '3', commandHex: Buffer.alloc(13, '02310D016E0300020000000055', 'hex'), power2: 'OFF' },
        { deviceId: 'Outlet', subId: '3', commandHex: Buffer.alloc(13, '02310D01E8030082000000124D', 'hex'), power2: 'ON' },   //방3
        { deviceId: 'Outlet', subId: '4', commandHex: Buffer.alloc(13, '02310D01220400010000000021', 'hex'), power1: 'OFF' },
        { deviceId: 'Outlet', subId: '4', commandHex: Buffer.alloc(13, '02310D011A04008100000009A2', 'hex'), power1: 'ON' },
        { deviceId: 'Outlet', subId: '4', commandHex: Buffer.alloc(13, '02310D011B0400020000000031', 'hex'), power2: 'OFF' },
        { deviceId: 'Outlet', subId: '4', commandHex: Buffer.alloc(13, '02310D011304008200000012AB', 'hex'), power2: 'ON' },   //방4
        { deviceId: 'Outlet', subId: '5', commandHex: Buffer.alloc(13, '02310D01D805000100000000E8', 'hex'), power1: 'OFF' },
        { deviceId: 'Outlet', subId: '5', commandHex: Buffer.alloc(13, '02310D01D4050081000000097B', 'hex'), power1: 'ON' },
        { deviceId: 'Outlet', subId: '5', commandHex: Buffer.alloc(13, '02310D01E205000200000000E3', 'hex'), power2: 'OFF' },
        { deviceId: 'Outlet', subId: '5', commandHex: Buffer.alloc(13, '02310D01E60500820000001275', 'hex'), power2: 'ON' },   //방5
        { deviceId: 'StandbyPw', subId: '1', commandHex: Buffer.alloc(13, '02310D01FA010000830000004E', 'hex'), power: 'ON' },
        { deviceId: 'StandbyPw', subId: '1', commandHex: Buffer.alloc(13, '02310D01010100000300000045', 'hex'), power: 'OFF' },
        { deviceId: 'StandbyPw', subId: '2', commandHex: Buffer.alloc(13, '02310D01EF020000830000005E', 'hex'), power: 'ON' },
        { deviceId: 'StandbyPw', subId: '2', commandHex: Buffer.alloc(13, '02310D01F902000003000000C8', 'hex'), power: 'OFF' },
        { deviceId: 'StandbyPw', subId: '3', commandHex: Buffer.alloc(13, '02310D013B0300008300000091', 'hex'), power: 'ON' },
        { deviceId: 'StandbyPw', subId: '3', commandHex: Buffer.alloc(13, '02310D01AE0300000300000094', 'hex'), power: 'OFF' },
        { deviceId: 'StandbyPw', subId: '4', commandHex: Buffer.alloc(13, '02310D018D040000830000003E', 'hex'), power: 'ON' },
        { deviceId: 'StandbyPw', subId: '4', commandHex: Buffer.alloc(13, '02310D019A04000003000000A9', 'hex'), power: 'OFF' },
        { deviceId: 'StandbyPw', subId: '5', commandHex: Buffer.alloc(13, '02310D01C80500008300000074', 'hex'), power: 'ON' },
        { deviceId: 'StandbyPw', subId: '5', commandHex: Buffer.alloc(13, '02310D01D205000003000000F2', 'hex'), power: 'OFF' },

        { deviceId: 'Fan', subId: '', commandHex: Buffer.alloc(10, '0261014c00000100002f', 'hex'), power: 'OFF' }, //꺼짐
        { deviceId: 'Fan', subId: '', commandHex: Buffer.alloc(10, '026101e3000101000089', 'hex'), power: 'ON' }, //켜짐
        { deviceId: 'Fan', subId: '', commandHex: Buffer.alloc(10, '0261071200100000006C', 'hex'), preset: 'nature OFF' }, //자연환기(꺼짐)
        { deviceId: 'Fan', subId: '', commandHex: Buffer.alloc(10, '0261071200100000006C', 'hex'), preset: 'nature ON' }, //자연환기(켜짐)
        { deviceId: 'Fan', subId: '', commandHex: Buffer.alloc(10, '026103eb00000100008a', 'hex'), preset: 'low' }, //약(켜짐)
        { deviceId: 'Fan', subId: '', commandHex: Buffer.alloc(10, '02610394000002000000', 'hex'), preset: 'medium' }, //중(켜짐)
        { deviceId: 'Fan', subId: '', commandHex: Buffer.alloc(10, '0261039f0000030000fc', 'hex'), preset: 'high' }, //강(켜짐)

        { deviceId: 'Thermo', subId: '1', commandHex: Buffer.alloc(14, '02280e12e90101000000000000e3', 'hex'), power: 'heat' }, // 온도조절기1-ON
        { deviceId: 'Thermo', subId: '1', commandHex: Buffer.alloc(14, '02280e12f70102000000000000c8', 'hex'), power: 'off' }, // 온도조절기1-OFF
        { deviceId: 'Thermo', subId: '2', commandHex: Buffer.alloc(14, '02280e12d30201000000000000ee', 'hex'), power: 'heat' },
        { deviceId: 'Thermo', subId: '2', commandHex: Buffer.alloc(14, '02280e12dd0202000000000000f5', 'hex'), power: 'off' },
        { deviceId: 'Thermo', subId: '3', commandHex: Buffer.alloc(14, '02280e127e030100000000000058', 'hex'), power: 'heat' },
        { deviceId: 'Thermo', subId: '3', commandHex: Buffer.alloc(14, '02280e12870302000000000000ba', 'hex'), power: 'off' },
        { deviceId: 'Thermo', subId: '4', commandHex: Buffer.alloc(14, '02280e12b8040100000000000091', 'hex'), power: 'heat' },
        { deviceId: 'Thermo', subId: '4', commandHex: Buffer.alloc(14, '02280e12c10402000000000000f7', 'hex'), power: 'off' },
        { deviceId: 'Thermo', subId: '5', commandHex: Buffer.alloc(14, '02280e12cc050100000000000008', 'hex'), power: 'heat' },
        { deviceId: 'Thermo', subId: '5', commandHex: Buffer.alloc(14, '02280e12be05020000000000008f', 'hex'), power: 'off' },
        { deviceId: 'Thermo', subId: '1', commandHex: Buffer.alloc(16, '', 'hex'), setTemp: '' }, // 온도조절기1-온도설정
        { deviceId: 'Thermo', subId: '2', commandHex: Buffer.alloc(14, '', 'hex'), setTemp: '' },
        { deviceId: 'Thermo', subId: '3', commandHex: Buffer.alloc(14, '', 'hex'), setTemp: '' },
        { deviceId: 'Thermo', subId: '4', commandHex: Buffer.alloc(14, '', 'hex'), setTemp: '' },
        { deviceId: 'Thermo', subId: '5', commandHex: Buffer.alloc(14, '', 'hex'), setTemp: '' },

        { deviceId: 'Gas', subId: '', commandHex: Buffer.alloc(10, '0231023c000000000011', 'hex'), power: 'OFF' }
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
                case 0x1e: case 0x91: case 0x81: //조명, 콘센트(0x91: 쿼리, 0x81: 명령응답)
                    this._msgLength = 30; break;
                case 0x82: case 0x3c: case 0x81: case 0x83: case 0x87: case 0x80: case 0x00: //가스(0x82: 명령응답, 0x80: 응답, 0x00: 쿼리)/환기(0x81,83,87: 명령응답)
                    this._msgLength = 10; break;
                case 0x10: case 0x92: case 0x10: case 0x91://난방(0x10,92: 명령응답, 0x10,91: 응답)
                    this._msgLength = 16; break;
                case 0x07: case 0x11: //난방(0x07,11: 쿼리)
                    this._msgLength = 7; break;
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
var retryCount = 0;

// MQTT-Broker 연결 
const client = mqtt.connect(mqttVar.broker, {
    port: mqttVar.port,
    username: mqttVar.username,
    password: mqttVar.password,
    clientId: mqttVar.clientId,
}, log("INFO   initialize mqtt..."));
client.on('connect', () => {
    log("INFO   MQTT connection successful!", /*"(" + mqttVar.broker + ")"*/);
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

// Energy
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
        log('INFO   Success connected to energy', /*"(" + energyVar.addr + ")"*/);
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
            return log('ERROR   Failed to open energy port:', err.message);
        }
    });
}
else {
    log('INFO   Control connection type: Socket')
    log('INFO   initialize socket...')
    control485 = new net.Socket();
    control485.connect(controlVar.port, controlVar.addr, function () {
        log('INFO   Success connected to control', /*"(" + controlVar.addr + ")"*/);
    });
    control485.on('error', (err) => {
        if (err.code == "ETIMEDOUT") {
            log("ERROR   Make sure socket is activated")
        } else { log('ERROR   Control connection failed:', err.message) }
    });
    control = control485.pipe(new CustomParser());
};

// 홈넷에서 SerialPort로 상태 정보 수신
energy.on('data', function (data) {
    lastReceive = new Date().getTime();

    if (data[0] != 0x02) {
        //log('WARNING   Packet stx not defined:', data.toString('hex', 0, 1), data.toString('hex', 1));
        return;
    }  // "베스틴 패킷은 길이가 불규칙 하여 가끔식 패킷이 튀는경우가 있음"

    if (data[2] == 0x1e && data[3] == 0x91) {
        var objFound = CONST.DEVICE_STATE.find(obj => data.includes(obj.stateHex));
        if (objFound || data.length === 30) {
            //조명, 콘센트 상태 정보
            updateStatus(objFound);
        }
        return;
    }
    // 딜레이
    commandProc();

    if (data[2] == 0x1e && data[3] == 0x81) {     //조명 및 콘센트 전원 '명령응답'
        const ack1 = Buffer.alloc(1);
        data.copy(ack1, 0, 1, 3);
        var objFoundIdx = queue.findIndex(obj => obj.commandHex.includes(ack1));
        if (objFoundIdx > -1) {
            log('INFO   Success command #Set State=', retryCount);
            queue.splice(objFoundIdx, 1);
            retryCount = 0;
        }
        return;
    }
});

control.on('data', function (data) {
    lastReceive = new Date().getTime();

    if (data[0] != 0x02) {
        //log('WARNING   Packet stx not defined:', data.toString('hex', 0, 1), data.toString('hex', 1));
        return;
    }
    if (data[2] == 0x80) {
        switch (data[1]) {
            case 0x31: case 0x61:
                var objFound = CONST.DEVICE_STATE.find(obj => data.includes(obj.stateHex));
                if (objFound || data.length === 10) {
                    //환기, 가스 상태 정보
                    updateStatus(objFound);
                }
                break;
        }
    }
    if (data[2] == 0x10 && data[3] == 0x91) {
        var objFound = CONST.DEVICE_STATE.find(obj => data.includes(obj.stateHex));
        if (objFound || data.length === 16) {
            //난방 상태 정보
            objFound.setTemp = ((data[7] & 0x3f) + (data[7] & 0x40 > 0) * 0.5).toString(10);  // 설정 온도  
            objFound.curTemp = ((data[9]) / 10.0).toString(10);  // 현재 온도
            updateStatus(objFound);
        }
        return;
    }
    // 딜레이
    commandProc();

    switch (data[2]) {
        case 0x81: case 0x82: case 0x83: case 0x87: //가스: 0x82 환기: 0x81,83,87
            const ack2 = Buffer.alloc(1);
            data.copy(ack2, 0, 1, 2);
            var objFoundIdx = queue.findIndex(obj => obj.commandHex.includes(ack2));
            if (objFoundIdx > -1) {
                log('INFO   Success command #Set State=', retryCount);
                queue.splice(objFoundIdx, 1);
                retryCount = 0;
            }
            break;
    }
    if (data[2] == 0x10 && data[3] == 0x92) {  //난방: 0x10,92
        const ack2 = Buffer.alloc(1);
        data.copy(ack2, 0, 1, 2, 3);
        var objFoundIdx = queue.findIndex(obj => obj.commandHex.includes(ack2));
        if (objFoundIdx > -1) {
            log('INFO   Success command #Set State=', retryCount);
            queue.splice(objFoundIdx, 1);
            retryCount = 0;
        }
        return;
    }
});

///////////////////////////////code rectify complete

// MQTT로 HA에 상태값 전송
var updateStatus = (obj) => {
    var arrStateName = Object.keys(obj);
    // 상태값이 아닌 항목들은 제외 [deviceId, subId, stateHex, commandHex, sentTime]
    const arrFilter = ['deviceId', 'subId', 'stateHex', 'commandHex', 'sentTime'];
    arrStateName = arrStateName.filter(stateName => !arrFilter.includes(stateName));

    // 상태값별 현재 상태 파악하여 변경되었으면 상태 반영 (MQTT publish)
    arrStateName.forEach(function (stateName) {
        // 상태값이 없거나 상태가 같으면 반영 중지
        var curStatus = homeStatus[obj.deviceId + obj.subId + stateName];
        if (obj[stateName] == null || obj[stateName] === curStatus) return;
        // 미리 상태 반영한 device의 상태 원복 방지
        if (queue.length > 0) {
            var found = queue.find(q => q.deviceId + q.subId === obj.deviceId + obj.subId && q[stateName] === curStatus);
            //log('WARNING  ', obj.deviceId + obj.subId, '->', 'State reflection complete & skip');
            if (found != null) return;
        }
        // 상태 반영 (MQTT publish)
        homeStatus[obj.deviceId + obj.subId + stateName] = obj[stateName];
        var topic = util.format(CONST.STATE_TOPIC, obj.deviceId, obj.subId, stateName);
        client.publish(topic, obj[stateName], { retain: true });
        log('INFO   Send to HA:', topic, '->', obj[stateName]);
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
                objFound.commandHex[3] = Number(value);
                objFound.setTemp = String(Number(value)); // 온도값은 소수점이하는 버림
                var xorSum = objFound.commandHex[0] ^ objFound.commandHex[1] ^ objFound.commandHex[2] ^ objFound.commandHex[3] ^ 0x80
                objFound.commandHex[7] = xorSum; // 마지막 Byte는 XOR SUM
            }
            // 다른 명령은 미리 정의해놓은 값을 매칭
            else {
                objFound = CONST.DEVICE_COMMAND.find(obj => obj.deviceId + obj.subId === topics[1] && obj[topics[2]] === value);
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
            objFound.sentTime = (new Date().getTime()) - CONST.sendDelay;
            queue.push(objFound);   // 실행 큐에 저장
            updateStatus(objFound); // 처리시간의 Delay때문에 미리 상태 반영
            retryCount = 0;
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
    energy485.write(obj.commandHex, (err) => { if (err) return log('ERROR  ', 'Send Error: ', err.message); });
    control485.write(obj.commandHex, (err) => { if (err) return log('ERROR  ', 'Send Error: ', err.message); });
    obj.sentTime = lastReceive;	// 명령 전송시간 sentTime으로 저장
    log('INFO  ', 'Send to Device:', obj.deviceId, obj.subId, '->', obj.state, obj.commandHex.toString('hex'));
    // ack메시지가 오지 않는 경우 방지
    if (retryCount++ < 20) {
        // 다시 큐에 저장하여 Ack 메시지 받을때까지 반복 실행
        queue.push(obj);
    } else {
        // 보통 패킷을 수정하다가 맨 뒤에 있는 체크섬이 틀리거나 ew11 과부하 걸리는 경우(ew11 재부팅 시도)
        log('ERROR   Packet send error Please check packet or ew11 =>', obj.commandHex.toString('hex'));
        retryCount = 0;
    }
}
 
setTimeout(() => { mqttReady = true; log('INFO   MQTT ready...') }, CONST.mqttDelay);
setInterval(commandProc, CONST.gapDelay);


