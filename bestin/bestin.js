/**
 * RS485 Homegateway for Bestin Homenet
 * @소스 공개 : Daehwan, Kang
 * @베스틴 홈넷용으로 수정 : harwin
 * @수정일 2022-12-29
 */

 const util = require('util');
 const net = require('net');
 const SerialPort = require('serialport').SerialPort;
 const mqtt = require('mqtt');
 
 // 커스텀 파서
 const Transform = require('stream').Transform;
 
 const CONFIG = require('/data/options.json');  //**** 애드온의 옵션을 불러옵니다. 이후 CONFIG.mqtt.username 과 같이 사용가능합니다. 

 // 각 디바이스 설정
 const energyVar = {
     type: CONFIG.energy.type,
     serName: CONFIG.energy.serName,
     addr: CONFIG.energy.address,
     port: CONFIG.energy.port
 };
 const controlVar = {
     type: CONFIG.control.type,
     serName: CONFIG.control.serName,
     addr: CONFIG.control.address,
     port: CONFIG.control.port
 };
 const smart1Var = {
     type: CONFIG.smart1.type,
     serName: CONFIG.smart1.serName,
     addr: CONFIG.smart1.address,
     port: CONFIG.smart1.port
 };
 const smart2Var = {
     type: CONFIG.smart2.type,
     serName: CONFIG.smart2.serName,
     addr: CONFIG.smart2.address,
     port: CONFIG.smart2.port
 };
 
 // MQTT 설정
 const mqttVar = {
     broker: CONFIG.mqtt.broker,
     port: CONFIG.mqtt.port,
     username: CONFIG.mqtt.username,
     password: CONFIG.mqtt.password,
     clientId: 'bestin_ipark',
 }; 
 
 const CONST = {
     // 포트이름 설정
     portEN: process.platform.startsWith('win') ? energyVar.serName : energyVar.serName,
     portCTRL: process.platform.startsWith('win') ? controlVar.serName : controlVar.serName,
     portRECV: process.platform.startsWith('win') ? smart1Var.serName : smart1Var.serName,
     portSEND: process.platform.startsWith('win') ? smart2Var.serName : smart2Var.serName,
     // SerialPort Delay(ms)
     SEND_DELAY: 100,
     MAX_RETRY: 30,
     // MQTT 수신 Delay(ms)
     MQTT_DELAY: 5000,
     // 메시지 Prefix 상수
     MSG_PREFIX: [0x02],
     MSG_HEADER: [0x31, 0x41, 0x42, 0xD1, 0x28, 0x61, 0xC1],
     // 디바이스 Hex코드
     DEVICE_STATE: [
         { deviceId: 'room', subId: '', component: 'light' },
         { deviceId: 'room', subId: '', component: 'outlet' },
         { deviceId: 'room', subId: '', component: 'outlet_cu' },
 
         { deviceId: 'gas', subId: '' },
         { deviceId: 'doorlock', subId: '' },
         { deviceId: 'fan', subId: '' },
         { deviceId: 'thermo', subId: '' },
         { deviceId: 'elevator', subId: '' }],
 
     DEVICE_COMMAND: [
         { deviceId: 'room', subId: '1', component: 'light', commandHex: Buffer.alloc(13, '02310D010001810000000004C6', 'hex'), light1: 'ON' },
         { deviceId: 'room', subId: '1', component: 'light', commandHex: Buffer.alloc(13, '02310D01000101000000000042', 'hex'), light1: 'OFF' },
         { deviceId: 'room', subId: '1', component: 'light', commandHex: Buffer.alloc(13, '02310D010001820000000004C1', 'hex'), light2: 'ON' },
         { deviceId: 'room', subId: '1', component: 'light', commandHex: Buffer.alloc(13, '02310D01000102000000000045', 'hex'), light2: 'OFF' },
         { deviceId: 'room', subId: '1', component: 'light', commandHex: Buffer.alloc(13, '02310D010001840000000004BB', 'hex'), light3: 'ON' },
         { deviceId: 'room', subId: '1', component: 'light', commandHex: Buffer.alloc(13, '02310D0100010400000000003F', 'hex'), light3: 'OFF' },
         { deviceId: 'room', subId: '1', component: 'light', commandHex: Buffer.alloc(13, '02310D010001880000000004BF', 'hex'), light4: 'ON' },
         { deviceId: 'room', subId: '1', component: 'light', commandHex: Buffer.alloc(13, '02310D0100010800000000003B', 'hex'), light4: 'OFF' },  //방1
         { deviceId: 'room', subId: '2', component: 'light', commandHex: Buffer.alloc(13, '02310D010002810000000004C3', 'hex'), light1: 'ON' },
         { deviceId: 'room', subId: '2', component: 'light', commandHex: Buffer.alloc(13, '02310D01000201000000000047', 'hex'), light1: 'OFF' },
         { deviceId: 'room', subId: '2', component: 'light', commandHex: Buffer.alloc(13, '02310D010002820000000004C4', 'hex'), light2: 'ON' },
         { deviceId: 'room', subId: '2', component: 'light', commandHex: Buffer.alloc(13, '02310D01000202000000000048', 'hex'), light2: 'OFF' },  //방2
         { deviceId: 'room', subId: '3', component: 'light', commandHex: Buffer.alloc(13, '02310D010003810000000004C8', 'hex'), light1: 'ON' },
         { deviceId: 'room', subId: '3', component: 'light', commandHex: Buffer.alloc(13, '02310D01000301000000000044', 'hex'), light1: 'OFF' },
         { deviceId: 'room', subId: '3', component: 'light', commandHex: Buffer.alloc(13, '02310D010003820000000004C7', 'hex'), light2: 'ON' },
         { deviceId: 'room', subId: '3', component: 'light', commandHex: Buffer.alloc(13, '02310D01000302000000000043', 'hex'), light2: 'OFF' },  //방3
         { deviceId: 'room', subId: '4', component: 'light', commandHex: Buffer.alloc(13, '02310D010004810000000004C5', 'hex'), light1: 'ON' },
         { deviceId: 'room', subId: '4', component: 'light', commandHex: Buffer.alloc(13, '02310D01000401000000000041', 'hex'), light1: 'OFF' },
         { deviceId: 'room', subId: '4', component: 'light', commandHex: Buffer.alloc(13, '02310D010004820000000004BA', 'hex'), light2: 'ON' },
         { deviceId: 'room', subId: '4', component: 'light', commandHex: Buffer.alloc(13, '02310D0100040200000000003E', 'hex'), light2: 'OFF' },  //방4
         { deviceId: 'room', subId: '5', component: 'light', commandHex: Buffer.alloc(13, '02310D010005810000000004BA', 'hex'), light1: 'ON' },
         { deviceId: 'room', subId: '5', component: 'light', commandHex: Buffer.alloc(13, '02310D0100050100000000003E', 'hex'), light1: 'OFF' },
         { deviceId: 'room', subId: '5', component: 'light', commandHex: Buffer.alloc(13, '02310D010005820000000004C5', 'hex'), light2: 'ON' },
         { deviceId: 'room', subId: '5', component: 'light', commandHex: Buffer.alloc(13, '02310D01000502000000000041', 'hex'), light2: 'OFF' },  //방5
 
         { deviceId: 'room', subId: '1', component: 'outlet', commandHex: Buffer.alloc(13, '02310D010001008100000009CB', 'hex'), outlet1: 'ON' },
         { deviceId: 'room', subId: '1', component: 'outlet', commandHex: Buffer.alloc(13, '02310D01000100010000000044', 'hex'), outlet1: 'OFF' },
         { deviceId: 'room', subId: '1', component: 'outlet', commandHex: Buffer.alloc(13, '02310D010001008200000012D3', 'hex'), outlet2: 'ON' },
         { deviceId: 'room', subId: '1', component: 'outlet', commandHex: Buffer.alloc(13, '02310D01000100020000000041', 'hex'), outlet2: 'OFF' },  //방1
         { deviceId: 'room', subId: '2', component: 'outlet', commandHex: Buffer.alloc(13, '02310D010002008100000009CE', 'hex'), outlet1: 'ON' },
         { deviceId: 'room', subId: '2', component: 'outlet', commandHex: Buffer.alloc(13, '02310D01000200010000000045', 'hex'), outlet1: 'OFF' },
         { deviceId: 'room', subId: '2', component: 'outlet', commandHex: Buffer.alloc(13, '02310D010002008200000012D6', 'hex'), outlet2: 'ON' },
         { deviceId: 'room', subId: '2', component: 'outlet', commandHex: Buffer.alloc(13, '02310D01000200020000000048', 'hex'), outlet2: 'OFF' },  //방2
         { deviceId: 'room', subId: '3', component: 'outlet', commandHex: Buffer.alloc(13, '02310D010003008100000009CD', 'hex'), outlet1: 'ON' },
         { deviceId: 'room', subId: '3', component: 'outlet', commandHex: Buffer.alloc(13, '02310D01000300010000000046', 'hex'), outlet1: 'OFF' },
         { deviceId: 'room', subId: '3', component: 'outlet', commandHex: Buffer.alloc(13, '02310D010003008200000012D5', 'hex'), outlet2: 'ON' },
         { deviceId: 'room', subId: '3', component: 'outlet', commandHex: Buffer.alloc(13, '02310D01000300020000000047', 'hex'), outlet2: 'OFF' },  //방3
         { deviceId: 'room', subId: '4', component: 'outlet', commandHex: Buffer.alloc(13, '02310D010004008100000009B8', 'hex'), outlet1: 'ON' },
         { deviceId: 'room', subId: '4', component: 'outlet', commandHex: Buffer.alloc(13, '02310D0100040001000000003F', 'hex'), outlet1: 'OFF' },
         { deviceId: 'room', subId: '4', component: 'outlet', commandHex: Buffer.alloc(13, '02310D010004008200000012B0', 'hex'), outlet2: 'ON' },
         { deviceId: 'room', subId: '4', component: 'outlet', commandHex: Buffer.alloc(13, '02310D0100040002000000003E', 'hex'), outlet2: 'OFF' },  //방4
         { deviceId: 'room', subId: '5', component: 'outlet', commandHex: Buffer.alloc(13, '02310D010005008100000009B7', 'hex'), outlet1: 'ON' },
         { deviceId: 'room', subId: '5', component: 'outlet', commandHex: Buffer.alloc(13, '02310D01000500010000000040', 'hex'), outlet1: 'OFF' },
         { deviceId: 'room', subId: '5', component: 'outlet', commandHex: Buffer.alloc(13, '02310D010005008200000012AF', 'hex'), outlet2: 'ON' },
         { deviceId: 'room', subId: '5', component: 'outlet', commandHex: Buffer.alloc(13, '02310D0100050002000000003D', 'hex'), outlet2: 'OFF' },  //방5
 
         { deviceId: 'room', subId: '1', component: 'outlet', commandHex: Buffer.alloc(13, '02310D010001000083000000C0', 'hex'), idlePower: 'ON' },
         { deviceId: 'room', subId: '1', component: 'outlet', commandHex: Buffer.alloc(13, '02310D01000100000300000040', 'hex'), idlePower: 'OFF' },
         { deviceId: 'room', subId: '2', component: 'outlet', commandHex: Buffer.alloc(13, '02310D010002000083000000C5', 'hex'), idlePower: 'ON' },
         { deviceId: 'room', subId: '2', component: 'outlet', commandHex: Buffer.alloc(13, '02310D01000200000300000045', 'hex'), idlePower: 'OFF' },
         { deviceId: 'room', subId: '3', component: 'outlet', commandHex: Buffer.alloc(13, '02310D010003000083000000C6', 'hex'), idlePower: 'ON' },
         { deviceId: 'room', subId: '3', component: 'outlet', commandHex: Buffer.alloc(13, '02310D01000300000300000046', 'hex'), idlePower: 'OFF' },
         { deviceId: 'room', subId: '4', component: 'outlet', commandHex: Buffer.alloc(13, '02310D010004000083000000C3', 'hex'), idlePower: 'ON' },
         { deviceId: 'room', subId: '4', component: 'outlet', commandHex: Buffer.alloc(13, '02310D01000400000300000043', 'hex'), idlePower: 'OFF' },
         { deviceId: 'room', subId: '5', component: 'outlet', commandHex: Buffer.alloc(13, '02310D010005000083000000BC', 'hex'), idlePower: 'ON' },
         { deviceId: 'room', subId: '5', component: 'outlet', commandHex: Buffer.alloc(13, '02310D0100050000030000003C', 'hex'), idlePower: 'OFF' },
 
         { deviceId: 'fan', subId: '', commandHex: Buffer.alloc(10, '0261010000010100006E', 'hex'), power: 'ON' }, //켜짐
         { deviceId: 'fan', subId: '', commandHex: Buffer.alloc(10, '0261010000000100006B', 'hex'), power: 'OFF' }, //꺼짐
         { deviceId: 'fan', subId: '', commandHex: Buffer.alloc(10, '0261030000000100006D', 'hex'), preset: 'low' }, //약(켜짐)
         { deviceId: 'fan', subId: '', commandHex: Buffer.alloc(10, '0261030000000200006C', 'hex'), preset: 'medium' }, //중(켜짐)
         { deviceId: 'fan', subId: '', commandHex: Buffer.alloc(10, '0261030000000300006B', 'hex'), preset: 'high' }, //강(켜짐)
         //{ deviceId: 'fan', subId: '', commandHex: Buffer.alloc(10, '0261070000100000007A', 'hex'), nature: 'OFF' }, //자연환기(꺼짐)
         //{ deviceId: 'fan', subId: '', commandHex: Buffer.alloc(10, '0261070000000000006A', 'hex'), nature: 'ON' }, //자연환기(켜짐)
         //{ deviceId: 'fan', subId: '', commandHex: Buffer.alloc(10, '026104FF00FF000000FF', 'hex'), timer: '' }, //타이머 
 
         { deviceId: 'thermo', subId: '1', commandHex: Buffer.alloc(14, '02280E1200010100000000000040', 'hex'), power: 'heat' }, // 온도조절기1-ON
         { deviceId: 'thermo', subId: '1', commandHex: Buffer.alloc(14, '02280E1200010200000000000041', 'hex'), power: 'off' }, // 온도조절기1-OFF
         { deviceId: 'thermo', subId: '2', commandHex: Buffer.alloc(14, '02280E120002010000000000003B', 'hex'), power: 'heat' },
         { deviceId: 'thermo', subId: '2', commandHex: Buffer.alloc(14, '02280E120002020000000000003E', 'hex'), power: 'off' },
         { deviceId: 'thermo', subId: '3', commandHex: Buffer.alloc(14, '02280E120003010000000000003E', 'hex'), power: 'heat' },
         { deviceId: 'thermo', subId: '3', commandHex: Buffer.alloc(14, '02280E120003020000000000003B', 'hex'), power: 'off' },
         { deviceId: 'thermo', subId: '4', commandHex: Buffer.alloc(14, '02280E1200040100000000000039', 'hex'), power: 'heat' },
         { deviceId: 'thermo', subId: '4', commandHex: Buffer.alloc(14, '02280E1200040200000000000038', 'hex'), power: 'off' },
         { deviceId: 'thermo', subId: '5', commandHex: Buffer.alloc(14, '02280E120005010000000000003C', 'hex'), power: 'heat' },
         { deviceId: 'thermo', subId: '5', commandHex: Buffer.alloc(14, '02280E120005020000000000003D', 'hex'), power: 'off' },
         { deviceId: 'thermo', subId: '1', commandHex: Buffer.alloc(14, '02280E12FF0100FF0000000000FF', 'hex'), setTemp: '' }, // 온도조절기1-온도설정
         { deviceId: 'thermo', subId: '2', commandHex: Buffer.alloc(14, '02280E12FF0200FF0000000000FF', 'hex'), setTemp: '' },
         { deviceId: 'thermo', subId: '3', commandHex: Buffer.alloc(14, '02280E12FF0300FF0000000000FF', 'hex'), setTemp: '' },
         { deviceId: 'thermo', subId: '4', commandHex: Buffer.alloc(14, '02280E12FF0400FF0000000000FF', 'hex'), setTemp: '' },
         { deviceId: 'thermo', subId: '5', commandHex: Buffer.alloc(14, '02280E12FF0500FF0000000000FF', 'hex'), setTemp: '' },
 
         { deviceId: 'gas', subId: '', commandHex: Buffer.alloc(10, '0231020000000000003D', 'hex'), power: 'OFF' },
         { deviceId: 'doorlock', subId: '', commandHex: Buffer.alloc(10, '0241020001000000004E', 'hex'), power: 'ON' },
         { deviceId: 'elevator', subId: '', commandHex: Buffer.alloc(12), call: 'ON' }],
 
     TOPIC_PRFIX: 'bestin',
     STATE_TOPIC: 'bestin/%s%s/%s/state', //상태 전달
     DEVICE_TOPIC: 'bestin/+/+/command' //명령 수신
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
         //this._wallpadType = CONST.WALLPAD_TYPE;
     }
     _transform(chunk, encoding, done) {
         var start = 0;
         for (var i = 0; i < chunk.length; i++) {
             if (CONST.MSG_PREFIX.includes(chunk[i]) && CONST.MSG_HEADER.includes(chunk[i + 1])) {
                 this._queueChunk.push(chunk.slice(start, i));
                 this.push(Buffer.concat(this._queueChunk));
                 this._queueChunk = [];
                 this._msgLenCount = 0;
                 start = i;
                 this._msgTypeFlag = true;
             }
 
             else if (this._msgTypeFlag) {
                 let length;
                 switch (chunk[i + 2]) {
                     case 0x07:
                         length = 7; break;
                     case 0x08:
                         length = 8; break;
                     case 0x00: case 0x80:
                         length = 10; break;
                     case 0x10:
                         length = 16; break;
                     case 0x30:
                         length = 20; break;
                     case 0x15:
                         length = 21; break;
                     case 0x1e:
                         length = 30; break;
                     default:
                         length = 0;
                 }
                 this._msgLength = length;
                 this._msgTypeFlag = false;
             }
 
             if (this._msgLenCount == this._msgLength - 1) { // 전체 메시지를 읽었을 경우
                 this._queueChunk.push(chunk.slice(start, i + 1)); // 구분자 앞부분을 큐에 저장하고
                 this.push(Buffer.concat(this._queueChunk)); // 큐에 저장된 메시지들 합쳐서 내보냄
                 this._queueChunk = []; // 큐 초기화
                 this._msgLenCount = 0;
                 start = i + 1;
             } else {
                 this._msgLenCount++;
             }
         }
         this._queueChunk.push(chunk.slice(start));
         done();
     }
 }
 
 // 로그 표시 
 var log = (...args) => console.log('[' + new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) + ']', args.join(' '));
 
 // 홈컨트롤 상태
 var homeStatus = {};
 var lastReceive = new Date().getTime();
 var mqttReady = false;
 var queue = new Array();
 var discoveryMessage = {};
 var retryCnt = 0;  // 수정금지
 //var packet1 = {};  //energy
 //var packet2 = {};  //control
 var packet3 = {};  //smart
 
 // MQTT-Broker 연결 
 const client = mqtt.connect('mqtt://' + mqttVar.broker, {
     port: mqttVar.port,
     username: mqttVar.username,
     password: mqttVar.password,
     clientId: mqttVar.clientId,
 }, log("initialize mqtt..."));
 client.on('connect', () => {
     log("[MQTT] Connection successful!", "(" + mqttVar.broker, mqttVar.port + ")" || "[MQTT] Connection fail...");
     client.subscribe(CONST.DEVICE_TOPIC, (err) => { if (err) log('[MQTT] Subscribe fail! -', CONST.DEVICE_TOPIC) });
 });
 
 const createConnection = (name, varObj, port) => {
     if (varObj.type == 'serial') {
         log(`${name} Connection type: Serial`);
         log('initialize serial...');
         const connection = new SerialPort({
             path: port,
             baudRate: 9600,
             dataBits: 8,
             parity: 'none',
             stopBits: 1,
             autoOpen: false,
             encoding: 'hex'
         });
         const dataStream = connection.pipe(new CustomParser());
         connection.on('open', () => log(`[SERIAL] Success open ${name} port:`, port));
         connection.on('close', () => log(`[SERIAL] Close ${name} port:`, port));
         connection.open((err) => {
             if (err) {
                 return log(`[SERIAL] failed to open ${name} port:`, err.message);
             }
         });
         return { connection, dataStream };
     } else {
         log(`${name} Connection type: Socket`);
         log('initialize socket...');
         const connection = new net.Socket();
         connection.connect(varObj.port, varObj.addr, function () {
             log(`[SOCKET] Success Connected to ${name}`, `(${varObj.addr} ${varObj.port})`);
         });
         connection.on('error', (err) => {
             if (err) {
                 return log(`[SOCKET] ${name} Connection failed:`, err.message);
             }
         });
         const dataStream = connection.pipe(new CustomParser());
         return { connection, dataStream };
     }
 }
 
 const energyConnection = createConnection('energy', energyVar, CONST.portEN);
 const energy = energyConnection.dataStream;
 const energy485 = energyConnection.connection;
 
 const controlConnection = createConnection('control', controlVar, CONST.portCTRL);
 const control = controlConnection.dataStream;
 const control485 = controlConnection.connection;
 
 const smart1Connection = createConnection('smart1', smart1Var, CONST.portRECV);
 const smart1 = smart1Connection.dataStream;
 const smart1485 = smart1Connection.connection;
 
 const smart2Connection = createConnection('smart2', smart2Var, CONST.portSEND);
 const smart2 = smart1Connection.dataStream;
 const smart2485 = smart1Connection.connection;
 
 //// Get Bestin Calculating checksum
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
         sum = ((data[i] ^ sum) + 1)
     }
     sum = sum & 0xff;
     return sum;
 }
 
 //// EnergyPacket Parser function code...
 function handleEnergyData(data) {
     let deviceId;
     let deviceState_light;
     let deviceState_outlet;
     let deviceCommand;
     let objFoundIdx;
     let objFound;
 
     deviceState_light = CONST.DEVICE_STATE.find(obj => (obj.deviceId === 'room') && (obj.component === 'light'));
     deviceState_outlet = CONST.DEVICE_STATE.find(obj => (obj.deviceId === 'room') && (obj.component === 'outlet'));
     deviceState_outlet_consumpution = CONST.DEVICE_STATE.find(obj => (obj.deviceId === 'room') && (obj.component === 'outlet_cu'));  //현재전력
 
     deviceCommand = CONST.DEVICE_COMMAND.find(obj => obj.deviceId === 'room');
 
     // 조명
     switch (data[3]) {
         case 0x91:
             if (!deviceState_light) return;
             deviceState_light.subId = data[5] & 0x0F;
             // 조명
 
             deviceState_light.light1 = (data[6] & 0x01) ? 'ON' : 'OFF';
             deviceState_light.light2 = (data[6] & 0x02) ? 'ON' : 'OFF';
             deviceState_light.light3 = (data[6] & 0x04) ? 'ON' : 'OFF';
             deviceState_light.light4 = (data[6] & 0x08) ? 'ON' : 'OFF';
             updateStatus(deviceState_light);
 
             if (!deviceState_outlet) return;
             deviceState_outlet.subId = data[5] & 0x0F;
             deviceState_outlet_consumpution.subId = data[5] & 0x0F;
 
             // 콘센트/현재전력
 
             deviceState_outlet.outlet1 = (data[7] & 0x01) ? 'ON' : 'OFF';
             deviceState_outlet.outlet2 = (data[7] & 0x02) ? 'ON' : 'OFF';
             //deviceState_outlet.idleCut1 = ((data[8] * 256 + data[9]) / 10).toString(10);
             //deviceState_outlet.idleCut2 = ((data[10] * 256 + data[11]) / 10).toString(10);
             deviceState_outlet_consumpution.curPower1 = ((data[14] * 256 + data[15]) / 10).toString(10);
             deviceState_outlet_consumpution.curPower2 = ((data[16] * 256 + data[17]) / 10).toString(10);
             deviceState_outlet_consumpution.curPower3 = ((data[18] * 256 + data[19]) / 10).toString(10);
             deviceState_outlet.idlePower = ((data.toString('hex')[14]) == 9) ? 'ON' : 'OFF';
             updateStatus(deviceState_outlet);
             updateStatus(deviceState_outlet_consumpution);
             break;
 
         // 조명/콘센트 명령
         case 0x81:
             if (!deviceCommand) return;
             deviceCommand = queue.findIndex(
                 (e) =>
                     data[3] == 0x81 &&
                     data[0] == e.commandHex[0] &&
                     data[1] == e.commandHex[1]
             );
             if (deviceCommand > -1) {
                 log('Success Command ack from Device #set state=', retryCnt);
                 queue.splice(deviceCommand, 1);
                 retryCnt = 0;
             }
             break;
     }
 }
 
 //// ControlPacket Parser function code...
 function handleControlData(data) {
     let deviceId;
     let deviceState;
     let deviceCommand;
     let objFoundIdx;
     let objFound;
 
     switch (data[1]) {
         case 0x31:
             deviceId = 'gas';
             break;
         case 0x41:
             deviceId = 'doorlock';
             break;
         case 0x61:
             deviceId = 'fan';
             break;
         case 0x28:
             deviceId = 'thermo';
             break;
         default:
             return;
     }
 
     deviceState = CONST.DEVICE_STATE.find(obj => obj.deviceId === deviceId);
     deviceCommand = CONST.DEVICE_COMMAND.find(obj => obj.deviceId === deviceId);
 
     // 가스/도어락/환기
     switch (data[2]) {
         case 0x80: // 상태
             if (!deviceState) return;
             if (deviceId === 'fan') {
                 deviceState.power = (data[5] & 0x01) ? 'ON' : 'OFF';
                 //deviceState.nature = ((data[5] & 0x10) >> 4) ? 'ON' : 'OFF';
                 //deviceState.timer = data[7];
                 switch (data[6]) {
                     case 0x01:
                         deviceState.preset = 'low'; break;
                     case 0x02:
                         deviceState.preset = 'medium'; break;
                     case 0x03:
                         deviceState.preset = 'high'; break;
                 }
             } else if (deviceId === 'gas') {
                 deviceState.power = (data[5] & 0x01) ? 'ON' : 'OFF';
             } else if (deviceId === 'doorlock') {
                 deviceState.power = (data[5] == 0x52) ? 'ON' : 'OFF';
             }
             updateStatus(deviceState);
             break;
 
         case 0x10: //난방 상태
             if (!deviceState) return;
             if (deviceId === 'thermo') {
                 if (data[3] !== 0x91) return;
                 deviceState.subId = data[5] & 0x0F;
                 switch (data[6]) {
                     case 0x01: case 0x06:
                         deviceState.power = 'heat'; break;
                     case 0x02:
                         deviceState.power = 'off'; break;
                     case 0x05:
                         deviceState.power = 'sleep'; break;
                     case 0x07:
                         deviceState.power = 'pause'; break;
                 }
                 deviceState.setTemp = ((data[7] & 0x3F) + (data[7] & 0x40 > 0) * 0.5).toString(10);
                 deviceState.curTemp = ((data[8] * 256 + data[9]) / 10.0).toString(10);
             }
             updateStatus(deviceState);
             break;
         case 0x10: // 제어
         case 0x81: 
         case 0x82:
         case 0x83:
         case 0x84:
         case 0x87:
             if (!deviceCommand) return;
             deviceCommand = queue.findIndex(
                 (e) =>
                     (data[2] === 0x81 || data[2] === 0x82 || data[2] === 0x83 || data[2] === 0x84 || data[2] === 0x87
                     || data[3] === 0x92) &&
                     data[0] === e.commandHex[0] &&
                     data[1] === e.commandHex[1]
             );
             if (deviceCommand > -1) {
                 log('Success Command ack from Device #set state=', retryCnt);
                 queue.splice(deviceCommand, 1);
                 retryCnt = 0;
             }
             break;
         default:
             return;
     }
 }
 
 function handleSmart1Data(data, packet3) {
     let deviceState;
     let deviceCommand;
 
     let floor = data[12];
     let state = packet3.state;
 
     deviceState = CONST.DEVICE_STATE.find(obj => obj.deviceId === 'elevator');
     deviceCommand = CONST.DEVICE_COMMAND.find(obj => obj.deviceId === 'elevator');
 
     if (!deviceState) return;
     deviceState.call = (state === '01') ? 'ON' : 'OFF';
     switch (state) {
         case '00': deviceState.direction = '대기'; break;   //idle
         case '01': deviceState.direction = '이동중'; break;   //moving
         case '04': deviceState.direction = '도착'; break;   //arrived
         default: deviceState.direction = '알 수 없음'; return;   //unknown        
     }
 
     if (floor === 0xff) {
         deviceState.floor = '대기 층';
     } else if (floor & 0x80) {
         deviceState.floor = `B${(floor & 0x7f).toString(10)} 층`;
     } else {
         deviceState.floor = `${(floor & 0xff).toString(10)} 층`;
     }
     updateStatus(deviceState);
 
     if (!deviceCommand) return;
     deviceCommand = queue.findIndex(
         (e) =>
             (data[11] === 0x01 && data[12] === 0xff) &&
             data[0] == e.commandHex[0] &&
             data[1] == e.commandHex[1]
     );
     if (deviceCommand > -1) {
         log('Success Command ack from Device #set state=', retryCnt);
         queue.splice(deviceCommand, 1);
         retryCnt = 0;
     }
 }
 
 smart1.on('data', function (data) {
     lastReceive = new Date().getTime();
     //console.log('Smart1>>', data.toString('hex'));
 
     if (data[3] == 0x13) {
         if (data.length >= 19) return;
         packet3 = {
             timestamp: data.slice(4, 5).toString('hex'),
             state: data.slice(11, 12).toString('hex'),
             floor: data.slice(12, 13).toString('hex')
         }
     } else {
         if (!data.length >= 6) return;
         packet3 = {
             timestamp: data.slice(4, 5).toString('hex')
         }
     };
     //console.log(data.length)
     //console.log('smart1 #timestamp:', packet3.timestamp)
     handleSmart1Data(data, packet3);
 });
 
 // 홈넷에서 SerialPort로 상태 정보 수신
 energy.on('data', function (data) {
     lastReceive = new Date().getTime();
     //console.log('Energy>>', data.toString('hex'));
 
     if (!data.length >= 30) return;
     //log(`packet prefix not defined! ${data.toString('hex')} #change to rs485 A/B`);
 
     if (data[2] !== 0x1e) return;
     handleEnergyData(data);
 });
 
 control.on('data', function (data) {
     lastReceive = new Date().getTime();
     //console.log('Control>>', data.toString('hex'));
 
     packet2 = {
         timestamp: data.slice(4, 5).toString('hex')
     }
  
     if (!data.length >= 10) return;
     if (!data.length >= 16) return;
     //log(`packet prefix not defined! ${data.toString('hex')} #change to rs485 A/B`);
 
     handleControlData(data);
 });
 
 smart2.on('data', function (data) {
     lastReceive = new Date().getTime();
     //console.log('Smart2>>', data.toString('hex'));
 
     if (!data.length >= 12) return;
     //log(`packet prefix not defined! ${data.toString('hex')} #change to rs485 A/B`);
 
     deviceCommand = CONST.DEVICE_COMMAND.find(obj => obj.deviceId === 'elevator');
 
     prefix = Buffer.from([0x02, 0xC1, 0X0C, 0X91])
     timestamp = Buffer.from(packet3.timestamp, 'hex')
     next_ts = Buffer.from([0x10, 0x01, 0x00, 0x02, 0x01, 0x02])
     data = Buffer.concat([prefix, timestamp, next_ts])
     buf_sum = Buffer.from(CheckSum(data, 11).toString(16), 'hex')
     buf_commandHex = Buffer.concat([data, buf_sum])
     deviceCommand.commandHex = buf_commandHex.toString('hex')
 
     //console.log(buf_commandHex)
 });
 
 // MQTT로 HA에 상태값 전송
 const updateStatus = (obj) => {
     if (!obj) return null;
 
     const arrFilter = ['deviceId', 'subId', 'stateHex', 'commandHex', 'sentTime', 'component', 'state'];
     const hideFilter = ['curPower1', 'curPower2', 'curPower3', 'curTemp'];
     const arrStateName = Object.keys(obj).filter(stateName => !arrFilter.includes(stateName));
 
     arrStateName.forEach((stateName) => {
         const curStatus = homeStatus[obj.deviceId + obj.subId + stateName];
         if (obj[stateName] == null || obj[stateName] === curStatus) return;
 
         if (queue.length > 0) {
             const found = queue.find(q => q.deviceId + q.subId === obj.deviceId + obj.subId && q[stateName] === curStatus);
             if (found != null) return;
         }
         homeStatus[obj.deviceId + obj.subId + stateName] = obj[stateName];
         const topic = util.format(CONST.STATE_TOPIC, obj.deviceId, obj.subId, stateName);
         client.publish(topic, obj[stateName], { retain: true });
 
         if (obj.deviceId === 'room' && obj.component === 'light') {
             const discoveryTopic = `homeassistant/light/${obj.deviceId}${obj.subId}/${stateName}/config`;
             const discoveryPayload = {
                 name: `bestin_${obj.deviceId}_${obj.subId}_${stateName}`, //bestin_room_1_light1
                 cmd_t: `${CONST.TOPIC_PRFIX}/${obj.deviceId}${obj.subId}/${stateName}/command`,
                 stat_t: `${CONST.TOPIC_PRFIX}/${obj.deviceId}${obj.subId}/${stateName}/state`,
                 uniq_id: `${obj.deviceId}_${obj.subId}_${stateName}`,
                 device: {
                     name: `bestin_${obj.deviceId}_${obj.subId}`, //bestin_room_1
                     ids: `bestin_${obj.deviceId}_${obj.subId}`,
                     mf: 'HDC',
                     mdl: 'BESTIN',
                     sw: '1.0'
                 },
             };
             client.publish(discoveryTopic, JSON.stringify(discoveryPayload), { retain: true });
         }
 
         if (obj.deviceId === 'room' && obj.component === 'outlet') {
             const discoveryTopic = `homeassistant/switch/${obj.deviceId}${obj.subId}/${stateName}/config`;
             const discoveryPayload = {
                 name: `bestin_${obj.deviceId}_${obj.subId}_${stateName}`, //bestin_room_1_outlet1
                 cmd_t: `${CONST.TOPIC_PRFIX}/${obj.deviceId}${obj.subId}/${stateName}/command`,
                 stat_t: `${CONST.TOPIC_PRFIX}/${obj.deviceId}${obj.subId}/${stateName}/state`,
                 ic: 'mdi:power-socket-eu',
                 uniq_id: `${obj.deviceId}_${obj.subId}_${stateName}`,
                 device: {
                     name: `bestin_${obj.deviceId}_${obj.subId}`, //bestin_room_1
                     ids: `bestin_${obj.deviceId}_${obj.subId}`,
                     mf: 'HDC',
                     mdl: 'BESTIN',
                     sw: '1.0'
                 },
             };
             client.publish(discoveryTopic, JSON.stringify(discoveryPayload), { retain: true });
         }
 
         if (obj.deviceId === 'room' && obj.component === 'outlet_cu') {
             const discoveryTopic = `homeassistant/sensor/${obj.deviceId}${obj.subId}/${stateName}/config`;
             const discoveryPayload = {
                 name: `bestin_${obj.deviceId}_${obj.subId}_${stateName}`, //bestin_room_1_curPower1
                 cmd_t: `${CONST.TOPIC_PRFIX}/${obj.deviceId}${obj.subId}/${stateName}/command`,
                 stat_t: `${CONST.TOPIC_PRFIX}/${obj.deviceId}${obj.subId}/${stateName}/state`,
                 unit_of_meas: "Wh",
                 ic: 'mdi:lightning-bolt',
                 uniq_id: `${obj.deviceId}_${obj.subId}_${stateName}`,
                 device: {
                     name: `bestin_${obj.deviceId}_${obj.subId}`, //bestin_room_1
                     ids: `bestin_${obj.deviceId}_${obj.subId}`,
                     mf: 'HDC',
                     mdl: 'BESTIN',
                     sw: '1.0'
                 },
             };
             client.publish(discoveryTopic, JSON.stringify(discoveryPayload), { retain: true });
         }
 
         if (obj.deviceId === 'thermo') {
             const discoveryTopic = `homeassistant/climate/${obj.deviceId}${obj.subId}/${stateName}/config`;
             const discoveryPayload = {
                 name: `bestin_${obj.deviceId}_${obj.subId}`, //bestin_thermo_1 
                 mode_cmd_t: `${CONST.TOPIC_PRFIX}/${obj.deviceId}${obj.subId}/power/command`,
                 mode_stat_t: `${CONST.TOPIC_PRFIX}/${obj.deviceId}${obj.subId}/power/state`,
                 temp_cmd_t: `${CONST.TOPIC_PRFIX}/${obj.deviceId}${obj.subId}/setTemp/command`,
                 temp_stat_t: `${CONST.TOPIC_PRFIX}/${obj.deviceId}${obj.subId}/setTemp/state`,
                 curr_temp_t: `${CONST.TOPIC_PRFIX}/${obj.deviceId}${obj.subId}/curTemp/state`,
                 min_temp: 5,
                 max_temp: 40,
                 temp_step: 0.1,
                 modes: ['off', 'heat'],
                 uniq_id: `${obj.deviceId}_${obj.subId}`,
                 device: {
                     name: `bestin_${obj.deviceId}`, //bestin_thermo
                     ids: `bestin_${obj.deviceId}`,
                     mf: 'HDC',
                     mdl: 'BESTIN',
                     sw: '1.0'
                 },
             };
             client.publish(discoveryTopic, JSON.stringify(discoveryPayload), { retain: true });
         }
 
         if (obj.deviceId === 'fan') {
             const discoveryTopic = `homeassistant/fan/${obj.deviceId}${obj.subId}/${stateName}/config`;
             const discoveryPayload = {
                 name: `bestin_${obj.deviceId}${obj.subId}`, //bestin_fan 
                 cmd_t: `${CONST.TOPIC_PRFIX}/${obj.deviceId}${obj.subId}/power/command`,
                 stat_t: `${CONST.TOPIC_PRFIX}/${obj.deviceId}${obj.subId}/power/state`,
                 pr_mode_cmd_t: `${CONST.TOPIC_PRFIX}/${obj.deviceId}${obj.subId}/preset/command`,
                 pr_mode_stat_t: `${CONST.TOPIC_PRFIX}/${obj.deviceId}${obj.subId}/preset/command`,
                 pr_modes: ['low', 'medium', 'high'],
                 uniq_id: `${obj.deviceId}${obj.subId}`,
                 device: {
                     name: `bestin_${obj.deviceId}`, //bestin_fan
                     ids: `bestin_${obj.deviceId}`,
                     mf: 'HDC',
                     mdl: 'BESTIN',
                     sw: '1.0'
                 },
             };
             client.publish(discoveryTopic, JSON.stringify(discoveryPayload), { retain: true });
         }
 
         if (obj.deviceId === 'gas') {
             const discoveryTopic = `homeassistant/switch/${obj.deviceId}${obj.subId}/${stateName}/config`;
             const discoveryPayload = {
                 name: `bestin_${obj.deviceId}${obj.subId}`, //bestin_gas
                 cmd_t: `${CONST.TOPIC_PRFIX}/${obj.deviceId}${obj.subId}/power/command`,
                 stat_t: `${CONST.TOPIC_PRFIX}/${obj.deviceId}${obj.subId}/power/state`,
                 uniq_id: `${obj.deviceId}${obj.subId}`,
                 ic: 'mdi:gas-cylinder',
                 device: {
                     name: `bestin_${obj.deviceId}`, //bestin_gas
                     ids: `bestin_${obj.deviceId}`,
                     mf: 'HDC',
                     mdl: 'BESTIN',
                     sw: '1.0'
                 },
             };
             client.publish(discoveryTopic, JSON.stringify(discoveryPayload), { retain: true });
         }
 
         if (obj.deviceId === 'doorlock') {
             const discoveryTopic = `homeassistant/lock/${obj.deviceId}${obj.subId}/${stateName}/config`;
             const discoveryPayload = {
                 name: `bestin_${obj.deviceId}${obj.subId}`, //bestin_doorlock
                 command_topic: `${CONST.TOPIC_PRFIX}/${obj.deviceId}${obj.subId}/${stateName}/command`,
                 state_topic: `${CONST.TOPIC_PRFIX}/${obj.deviceId}${obj.subId}/${stateName}/state`,
                 payload_lock: 'OFF',
                 payload_unlock: 'ON',
                 state_locked: 'OFF',
                 state_unlocked: 'ON',
                 uniq_id: `${obj.deviceId}${obj.subId}`,
                 device: {
                     name: `bestin_${obj.deviceId}`, //bestin_doorlock
                     ids: `bestin_${obj.deviceId}`,
                     mf: 'HDC',
                     model: 'BESTIN',
                     sw: '1.0'
                 },
             };
             client.publish(discoveryTopic, JSON.stringify(discoveryPayload), { retain: true });
         }
 
         if (!hideFilter.includes(stateName)) {
             log('[MQTT] Send to HA:', topic, '->', obj[stateName]);
         }
     });
 };
 
 client.on('message', (topic, message) => {
     if (!mqttReady) return;
     const topics = topic.split('/');
     const value = message.toString();
     let command;
 
     if (topics[0] === CONST.TOPIC_PRFIX) {
         if (topics[2] === 'setTemp') {
             command = CONST.DEVICE_COMMAND.find(
                 obj => obj.deviceId + obj.subId === topics[1] && obj.hasOwnProperty('setTemp')
             );
             command.commandHex[4] = packet2.timestamp;
             command.commandHex[7] = Number(value);
             command.setTemp = String(Number(value));
             data = command.commandHex;
             command.commandHex[13] = CheckSum(data, 11);
         } else if (topics[2] === 'timer') {
             command = CONST.DEVICE_COMMAND.find(
                 obj => obj.deviceId + obj.subId === topics[1] && obj.hasOwnProperty('timer')
             );
             command.commandHex[3] = packet2.timestamp;
             command.commandHex[5] = Number(value);
             command.timer = String(Number(value));
             data = command.commandHex;
             command.commandHex[13] = CheckSum(data, 11);
         } else {
             command = CONST.DEVICE_COMMAND.find(
                 obj => obj.deviceId + obj.subId === topics[1] && obj[topics[2]] === value
             );
         }
     }
 
     if (!command) {
         log('[MQTT] Receive unknown msg: ', topic, ':', value);
         return;
     }
 
     if (value === homeStatus[command.deviceId + command.subId + command[topics[2]]]) {
         log('[MQTT] Receive & Skip: ', topic, ':', value);
     } else {
         log('[MQTT] Receive from HA:', topic, ':', value);
         command.sentTime = Date.now() - CONST.SEND_DELAY;
         queue.push(command);
         updateStatus(command);
         setTimeout(updateStatus, 1000);
         retryCnt = 0;
     }
 });
 
 const commandProc = () => {
     if (queue.length === 0) {
         return;
     }
 
     const delay = (new Date().getTime()) - lastReceive;
     if (delay < CONST.SEND_DELAY || !mqttReady) {
         return;
     }
 
     const obj = queue.shift();
     const deviceId = obj.deviceId;
     const subId = obj.subId;
     const state = obj.state;
     const commandHex = obj.commandHex;
 
     switch (deviceId) {
         case 'room':
             energy485.write(commandHex, handleWriteError);
             log('energy>> Send to Device:', deviceId, subId, 'light/outlet', '->', state, commandHex.toString('hex'));
             break;
         case 'fan':
         case 'thermo':
         case 'gas':
         case 'doorlock':
             control485.write(commandHex, handleWriteError);
             log('control>> Send to Device:', deviceId, subId, '->', state, commandHex.toString('hex'));
             break;
         case 'elevator':
             smart2485.write(commandHex, handleWriteError);
             log('smart>> Send to Device:', deviceId, subId, '->', state, commandHex.toString('hex'));
             break;
         default:
             break;
     }
     obj.sentTime = lastReceive;
 
     retryCnt++;
     if (retryCnt < CONST.MAX_RETRY) {
         queue.push(obj);
     } else {
         log(`#${deviceId} max retry count exceeded! to ${commandHex.toString('hex')}`);
         retryCnt = 0;
     }
 };
 
 const handleWriteError = (err) => {
     if (err) {
         log('Send error:', err.message);
     }
 };
 
 setTimeout(() => { mqttReady = true; log('MQTT ready...') }, CONST.MQTT_DELAY);
 setInterval(commandProc, 20);
