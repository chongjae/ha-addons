/*
 * RS485 Homegateway for Bestin Homenet
 * @소스 공개 : Daehwan, Kang
 * @베스틴 홈넷용으로 수정 : harwin
 * @수정일 2022-1-10
 */

const fs = require('fs');
const util = require('util');
const net = require('net');
const SerialPort = require('serialport').SerialPort;
const mqtt = require('mqtt');
const request = require('request');
const xml2js = require('xml2js');

// 커스텀 파서
const Transform = require('stream').Transform;
const CONFIG = require('/data/options.json');

// 로그 표시 
const log = (...args) => console.log('[' + (new Date()).toLocaleString() + ']', 'INFO     ', args.join(' '));
const warn = (...args) => console.warn('[' + (new Date()).toLocaleString() + ']', 'WARNING  ', args.join(' '));
const error = (...args) => console.error('[' + (new Date()).toLocaleString() + ']', 'ERROR    ', args.join(' '));

const CONST = {
    // 시리얼 전송 설정
    DEVICE_READY_DELAY: 5000,
    DEVICE_SEND_RETRY_DELAY: CONFIG.retry_delay,
    DEVICE_SEND_RETRY_COUNT: CONFIG.retry_count,
    // 메시지 Prefix 상수
    MSG_PREFIX: [0x02],
    MSG_HEADERS: [0x31, 0x41, 0x42, 0xd1, 0x28, 0x61, 0xc1],
    // MQTT 토픽
    TOPIC_PRFIX: 'bestin',
    STATE_TOPIC: 'bestin/%s/%s/%s/state',
    COMMAND_TOPIC: 'bestin/+/+/+/command',
    HA_STATE_TOPIC: 'homeassistant/status',
    ///////////
    MSG_INFO: [
        /////////////////////////////////////////////////////////////////////////////
        //command <-> response
        {
            header: 0x31, cmd: 0x01, len: 13, req: 'set', device: 'light', property: { },
            setPropertyToMsg: (buf, room_idx, name, value) => {
                let idx = name.slice(5, 6);
                buf[5] = room_idx & 0x0F;
                if (name.includes('power')) {
                    buf[6] = ((0x01 << idx - 1) | (value == 'on' ? 0x80 : 0x00));
                    buf[11] = (value == 'on' ? 0x04 : 0x00);
                } else if (name == 'batch') {
                    buf[6] = (value == 'on' ? 0x8F : 0x0F);
                    buf[11] = (value == 'on' ? 0x04 : 0x00);
                }

                return buf;
            }
        },
        {
            header: 0x31, cmd: 0x81, len: 30, req: 'ack', device: 'light', property: { },
            parseToProperty: (buf) => {
                if ((buf[6] & 0x0F) == 0) {
                    return [];
                } else {
                    var propArr = [];
                    if ((buf[5] & 0x0F) == 1) { var lightN = 3; } else { var lightN = 2; }
                    for (let i = 0; i < lightN; i++) {
                        propArr.push({
                            device: 'light',
                            room_index: buf[5] & 0x0F,
                            propertyName: 'power' + (i + 1),
                            propertyValue: ((buf[6] & (1 << i)) ? 'on' : 'off'),
                        }, {
                            device: 'light',
                            room_index: buf[5] & 0x0F,
                            propertyName: 'batch',
                            propertyValue: ((buf[6] & 0x0F) ? 'on' : 'off'),
                        });
                    }
                }
                return propArr;
            }
        },

        {
            header: 0x28, cmd: 0x12, len: 14, req: 'set', device: 'thermostat', property: { mode: 'off' },
            setPropertyToMsg: (buf, room_idx, name, value) => {
                if (value == 'fan_only') {
                    buf[8] = 0x77
                    buf[9] = 0x77
                    buf[10] = 0x07
                } else {
                    buf[5] = room_idx & 0x0F;
                    buf[6] = (value == 'heat' ? 0x01 : 0x02);
                }

                return buf;
            }
        },
        {
            header: 0x28, cmd: 0x92, len: 16, req: 'ack', device: 'thermostat', property: { mode: 'off' },
            parseToProperty: (buf) => {
                return [{
                    device: 'thermostat', room_index: buf[5] & 0x0F, propertyName: 'mode',
                    propertyValue: buf[6] == 0x07 ? 'fan_only' : ((buf[6] & 0x01) ? "heat" : "off")
                }];
            }
        },

        {
            header: 0x28, cmd: 0x12, len: 14, req: 'set', device: 'thermostat', property: { setting: 0 },
            setPropertyToMsg: (buf, room_idx, name, value) => {
                buf[5] = room_idx & 0x0F;
                value_int = parseInt(value);
                value_float = value - value_int;
                buf[7] = ((value_int & 0xFF) | ((value_float != 0) ? 0x40 : 0x00));

                return buf;
            }
        },
        {
            header: 0x28, cmd: 0x92, len: 16, req: 'ack', device: 'thermostat', property: { setting: 0 },
            parseToProperty: (buf) => {
                return [{
                    device: 'thermostat', room_index: buf[5] & 0x0F, propertyName: 'setting',
                    propertyValue: (buf[7] & 0x3F) + ((buf[7] & 0x40) > 0) * 0.5
                }];
            }
        },

        {
            header: 0x61, len: 10, req: 'set', device: 'ventil', property: { power: 'off', speed: 1 },
            setPropertyToMsg: (buf, room_idx, name, value) => {
                if (name == 'power') {
                    buf[2] = 0x01
                    buf[5] = (value == 'on' ? 0x01 : 0x00);
                    buf[6] = 0x01
                } else if (name == 'speed') {
                    buf[2] = 0x03
                    buf[6] = Number(value);
                }

                return buf;
            }
        },
        {
            header: 0x61, cmd: 0x81, len: 10, req: 'ack', device: 'ventil', property: { power: 'off', speed: 1 },
            parseToProperty: (buf) => {
                var value = undefined;
                if (buf[5] == 0x00 || buf[5] == 0x01) {
                    value = (buf[5] & 0x01) ? 'on' : 'off';
                } else {
                    value = buf[6];
                }

                return [{ device: 'ventil', room_index: 1, propertyName: 'speed', propertyValue: value }];
            }
        },

        {
            header: 0x31, cmd: 0x02, len: 10, req: 'set', device: 'gas', property: { power: 'off' },
            setPropertyToMsg: (buf, room_idx, name, value) => {

                return buf;
            }
        },
        {
            header: 0x31, cmd: 0x82, len: 10, req: 'ack', device: 'gas', property: { power: 'off' },
            parseToProperty: (buf) => {
                return [{ device: 'gas', room_index: 1, propertyName: 'power', propertyValue: 'off' }];
            }
        },

        /////////////////////////////////////////////////////////////////////////////
        //query <-> response
        {
            header: 0x31, cmd: 0x11, len: 7, req: 'get', device: 'light', property: { },
            setPropertyToMsg: (buf, room_idx, name, value) => {
                buf[5] = room_idx

                return buf;
            }
        },
        {
            header: 0x31, cmd: 0x91, len: 30, req: 'ack', device: 'light', property: { },
            parseToProperty: (buf) => {
                var propArr = [];
                if ((buf[5] & 0x0F) == 1) { var lightN = 3; } else { var lightN = 2; };
                for (let i = 0; i < lightN; i++) {
                    propArr.push({
                        device: 'light', room_index: buf[5] & 0x0F, propertyName: 'power' + (i + 1),
                        propertyValue: ((buf[6] & (1 << i)) ? 'on' : 'off')
                    }, {
                        device: 'light', room_index: buf[5] & 0x0F, propertyName: 'batch',
                        propertyValue: ((buf[6] & 0x0F) ? 'on' : 'off')
                    });
                }

                return propArr;
            }
        },

        {
            header: 0x28, cmd: 0x11, len: 7, req: 'get', device: 'thermostat', property: { mode: 'off', setting: 0, current: 0 },
            setPropertyToMsg: (buf, room_idx, name, value) => {
                buf[5] = room_idx

                return buf;
            }
        },
        {
            header: 0x28, cmd: 0x91, len: 16, req: 'ack', device: 'thermostat', property: { mode: 'off', setting: 0, current: 0 },
            parseToProperty: (buf) => {
                return [{
                    device: 'thermostat', room_index: buf[5] & 0x0F, propertyName: 'mode',
                    propertyValue: buf[6] == 0x07 ? 'fan_only' : ((buf[6] & 0x01) ? "heat" : "off")
                }, {
                    device: 'thermostat', room_index: buf[5] & 0x0F, propertyName: 'setting',
                    propertyValue: (buf[7] & 0x3F) + ((buf[7] & 0x40) > 0) * 0.5
                }, {
                    device: 'thermostat', room_index: buf[5] & 0x0F, propertyName: 'current', propertyValue: (buf[8] << 8 | buf[9]) / 10
                }];
            }
        },

        {
            header: 0x61, cmd: 0x00, len: 10, req: 'get', device: 'ventil', property: { power: 'off', speed: 1 },
            setPropertyToMsg: (buf, room_idx, name, value) => {

                return buf;
            }
        },
        {
            header: 0x61, cmd: 0x80, len: 10, req: 'ack', device: 'ventil', property: { power: 'off', speed: 1 },
            parseToProperty: (buf) => {
                return [{
                    device: 'ventil', room_index: 1, propertyName: 'power', propertyValue: (buf[5] ? 'on' : 'off')
                }, {
                    device: 'ventil', room_index: 1, propertyName: 'speed', propertyValue: buf[6]
                }];
            }
        },

        {
            header: 0x31, cmd: 0x00, len: 10, req: 'get', device: 'gas', property: { power: 'off' },
            setPropertyToMsg: (buf, room_idx, name, value) => {

                return buf;
            }
        },
        {
            header: 0x31, cmd: 0x80, len: 10, req: 'ack', device: 'gas', property: { power: 'off' },
            parseToProperty: (buf) => {

                return [{ device: 'gas', room_index: 1, propertyName: 'power', propertyValue: (buf[5] ? 'on' : 'off') }];
            }
        },

        {
            header: 0xD1, cmd: 0x02, len: 7, req: 'get', device: 'energy', property: { },
            setPropertyToMsg: (buf, room_idx, name, value) => {

                return buf;
            }
        },
        {
            header: 0xD1, cmd: 0x82, len: 48, req: 'ack', device: 'energy', property: { },
            parseToProperty: (buf) => {
                const startIndex = { electric: 13, heat: 21, hotwater: 29, gas: 37, water: 45 };
                const convert = (startIndex, buf) => {
                    return ((buf[startIndex].toString(16)).padStart(2, '0') + (buf[startIndex + 1].toString(16)).padStart(2, '0'));
                }
                var propArr = [];
                for (let name in startIndex) {
                    consumption = convert(startIndex[name], buf);
                    propArr.push({ device: 'energy', room_index: name, propertyName: 'current', propertyValue: consumption });
                }

                return propArr;
            }
        },

    ],
};

class CustomParser extends Transform {
    constructor(options) {
        super(options);
        this.reset();
    }

    reset() {
        this._queueChunk = [];
        this._msgLenCount = 0;
        this._msgLength = null;
        this._msgTypeFlag = false;  // 다음 바이트는 메시지 종류
    }

    _transform(chunk, encoding, done) {
        let start = 0;
        for (let i = 0; i < chunk.length; i++) {
            if (CONST.MSG_PREFIX.includes(chunk[i]) && CONST.MSG_HEADERS.includes(chunk[i + 1])) {
                // 앞 prefix                                                   // 두번째 바이트
                this.pushBuffer();
                start = i;
                this._msgTypeFlag = true;
            } else if (this._msgTypeFlag) {
                this._msgLength = chunk[i + 1] + 1;
                this._msgTypeFlag = false;
                if (!this._msgLength === chunk[i + 1] + 1) {
                    // 모든 packet의 3번째 바이트는 그 패킷의 전체 길이의 나타냄
                    this.reset();
                    return done(new Error('Invalid message length'));
                    // 패킷 길의 검증
                }
            }

            if (this._msgLenCount === this._msgLength - 1) {
                this.pushBuffer();
                start = i;
            } else {
                this._msgLenCount++;
            }
        }
        this._queueChunk.push(chunk.slice(start));  
        done();
    }

    pushBuffer() {
        this.push(Buffer.concat(this._queueChunk));  // 큐에 저장된 메시지들 합쳐서 내보냄
        this.reset();
    }
}

class HomeRS485 {
    constructor() {
        this._serverStartTime = new Date();
        this._receivedMsgs = [];
        this._deviceReady = false;
        this._syncTime = new Date();
        this._lastReceive = new Date();
        this._commandQueue = new Array();
        this._serialCmdQueue = new Array();
        this._deviceStatusCache = {};
        this._deviceStatus = [];
        this._timestamp = undefined;

        this._mqttClient = this.MqttClient();
        const { energy, control } = CONFIG;
        this._socketWriteEnergy = this.createSocketConnection(energy, 'energy');
        this._socketWriteControl = this.createSocketConnection(control, 'control');
        this._iparkServerInfo = this.IparkLoginRequest();
    }

    MqttClient() {
        const client = mqtt.connect('mqtt://' + CONFIG.mqtt.broker, {
            port: CONFIG.mqtt.port,
            username: CONFIG.mqtt.username,
            password: CONFIG.mqtt.password,
            clientId: 'BESTIN_WALLPAD',
        });

        client.on('connect', () => {
            log("MQTT connection successful!");
            const topics = [CONST.COMMAND_TOPIC, CONST.HA_STATE_TOPIC];
            topics.forEach(topic => {
                client.subscribe(topic, (err) => {
                    if (err) {
                        error(`failed to subscribe to ${topic}`);
                    }
                });
            });
        });

        client.on("reconnect", function () {
            warn("mqtt connection lost. attempting to reconnect...");
        });
        log('initializing mqtt...');

        // ha에서 mqtt로 제어 명령 수신
        client.on('message', this.MqttCmdHandle.bind(this));
        return client;
    }

    MqttCmdHandle(topic, message) {
        if (this._deviceReady) {
            var topics = topic.split('/');
            var value = message.toString(); // message buffer이므로 string으로 변환		
            if (topics[0] === CONST.TOPIC_PRFIX) {
                // mqtt 토픽 변환
                this.SetDeviceProperty(topics[1], topics[2], topics[3], value);
            }
        } else {
            warn('mqtt is not ready. wait..');
        }
    }

    UpdateMqttDeviceStatus(device, room_idx, propertyName, propertyValue) {
        //console.log(device, room_idx, propertyName, propertyValue);
        
        //setTimeout(() => {
            const topic = util.format(CONST.STATE_TOPIC, device, room_idx, propertyName);
            // 현재전력/온도는 로깅 제외
            if (propertyName != 'current') {
                log('publish mqtt:', topic, '=', propertyValue);
            }
            this._mqttClient.publish(topic, String(propertyValue));
        //}, 5000);
    }

    DiscoveryPayload(device, room_idx, propertyName) {        
        let topic;
        let payload;

        switch (device) {
            case 'light':
                topic = `homeassistant/light/bestin_wallpad/light_${room_idx}/config`;
                payload = {
                    name: `bestin_light_${room_idx}_${propertyName}`,
                    cmd_t: `bestin/light/${room_idx}/${propertyName}/command`,
                    stat_t: `bestin/light/${room_idx}/${propertyName}/state`,
                    uniq_id: `light_${room_idx}_${propertyName}`,
                    pl_on: 'on',
                    pl_off: 'off',
                    opt: true,
                }
                break;
            case 'thermostat':
                topic = `homeassistant/climate/bestin_wallpad/thermostat_${room_idx}/config`;
                payload = {
                    name: `bestin_thermostat_${room_idx}`,
                    mode_cmd_t: `bestin/thermostat/${room_idx}/power/command`,
                    mode_stat_t: `bestin/thermostat/${room_idx}/power/state`,
                    temp_cmd_t: `bestin/thermostat/${room_idx}/setting/command`,
                    temp_stat_t: `bestin/thermostat/${room_idx}/setting/state`,
                    curr_temp_t: `bestin/thermostat/${room_idx}/current/state`,
                    uniq_id: `thermostat_${room_idx}`,
                    modes: ['off', 'heat', 'fan_only'],
                    min_temp: 5,
                    max_temp: 40,
                    temp_step: 0.5,
                }
                break;
            case 'ventil':
                topic = `homeassistant/fan/bestin_wallpad/ventil_1/config`;
                payload = {
                    name: `bestin_ventil_1`,
                    cmd_t: `bestin/ventil/1/power/command`,
                    stat_t: `bestin/ventil/1/power/state`,
                    pr_mode_cmd_t: `bestin/ventil/1/speed/command`,
                    pr_mode_stat_t: `bestin/ventil/1/speed/state`,
                    pr_modes: ['01', '02', '03'],
                    uniq_id: `vnetil_1`,
                    pl_on: 'on',
                    pl_off: 'off',
                }
            case 'gas':
                topic = `homeassistant/switch/bestin_wallpad/gas_1/config`;
                payload = {
                    name: `bestin_gas_1`,
                    cmd_t: `bestin/gas/1/power/command`,
                    stat_t: `bestin/gas/1/power/state`,
                    uniq_id: `gas_1`,
                    pl_on: 'on',
                    pl_off: 'off',
                    ic: 'mdi:gas-cylinder',
                    ret: true,
                }
            default:
                return;
        }
        this.MqttDiscovery(topic, payload);
    }

    MqttDiscovery(topic, payload) {
        let stopped = false;
        let previousHatopic = '';
        const hatopic = util.format(topic);
        payload = {
            ids: ["bestin_wallpad"],
            name: "bestin_wallpad",
            mf: "HDC BESTIN",
            mdl: "HDC BESTIN Wallpad",
            sw: "harwin1/bestin-v1/bestin-new",
        };

        const publish = setTimeout(() => {
            if (!stopped && previousHatopic !== hatopic) {
                previousHatopic = hatopic;
                this._mqttClient.publish(hatopic, JSON.stringify(payload), { qos: 2 });
            }
        }, 500);
        setTimeout(() => {
            clearTimeout(publish);
            stopped = true;
        }, 5000);
    }


    // 패킷 체크섬 검증
    VerifyCheckSum(packet) {
        // 3으로 초기화
        let result = 0x03;
        for (let i = 0; i < packet.length; i++) {
            result ^= packet[i];
            result = (result + 1) & 0xff;
            // 바이트를 순차적으로 xor 한뒤 +1 / 8비트로 truncation
        }
        return result;
    }

    // 명령 패킷 마지막 바이트(crc) 생성
    AddCheckSum(packet) {
        let result = 0x03;
        for (let i = 0; i < packet.length - 1; i++) {
            result ^= packet[i];
            result = (result + 1) & 0xff;
        }
        return result;
    }

    createSerialConnection(options, name) {
        const connection = new SerialPort({
            path: options.serPath,
            baudRate: 9600,
            dataBits: 8,
            parity: 'none',
            stopBits: 1,
            autoOpen: false,
            encoding: 'hex'
        });

        connection.pipe(new CustomParser()).on('data', this.PacketHandle.bind(this));
        connection.on('open', () => {
            log(`Successfully opened ${name} port: ${options.serPath}`);
            setTimeout(() => {
                this._deviceReady = true;
                log(`serial-${name} service ready...`)
                // device connect 딜레이
            }, CONST.DEVICE_READY_DELAY);
        });
        connection.on('close', () => {
            warn(`closed ${name} port: ${options.serPath}`);
        });
        connection.open((err) => {
            if (err) {
                error(`failed to open ${name} port: ${err.message}`);
            }
        });

        return connection;
    }

    createSocketConnection(options, name) {
        const connection = new net.Socket();

        connection.connect(options.port, options.address, () => {
            log(`Successfully connected to ${name}`);
            setTimeout(() => {
                this._deviceReady = true;
                log(`socket-${name} service ready...`)
                // device connect 딜레이
            }, CONST.DEVICE_READY_DELAY);
        });
        connection.on('error', (err) => {
            error(`connection error ${err.code}::${name.toUpperCase()}. attempting to reconnect...`);
            connection.connect(options.port, options.addr);
            // 연결 애러 발생시 reconnect
        });
        connection.pipe(new CustomParser()).on('data', this.PacketHandle.bind(this));

        return connection;
    }

    PacketHandle(packet) {
        //console.log(packet.toString('hex'))
        let isNew = false;
        this._lastReceive = new Date();  //Or 0x42
        if (packet[0] == 0x02 && packet[1] == 0x41) {
            // energy 포트에서 싱크메시지 추청
            this._syncTime = this._lastReceive;
            this._timestamp = packet[4]; // spin_code(0x00-0xff)
        }
        let receivedMsg = this._receivedMsgs.find(e => e.codeHex.equals(packet));

        if (!receivedMsg) {
            isNew = true;
            var foundMsgInfo = CONST.MSG_INFO.find(e => e.header == packet[1] && e.len == packet[2] && e.cmd == packet[3]);
            if (!foundMsgInfo) {
                foundMsgInfo = CONST.MSG_INFO.find(e => e.header == packet[1] && e.cmd == packet[2]);
            }

            receivedMsg = {
                code: packet.toString('hex'),
                codeHex: packet,
                count: 0,
                info: foundMsgInfo
            };
            receivedMsg.checksum = this.VerifyCheckSum(packet);
            this._receivedMsgs.push(receivedMsg);
        }

        receivedMsg.count++;
        receivedMsg.lastlastReceive = receivedMsg.lastReceive;
        receivedMsg.lastReceive = this._lastReceive;
        receivedMsg.timeslot = this._lastReceive - this._syncTime;

        if (!receivedMsg.checksum) {
            error(`checksum error. return message - 0x${receivedMsg.checksum.toString(16)}`);
            return;
        }

        if (!receivedMsg.info) {
            //warn(`Invalid packet message - ${receivedMsg.code}`);
            return;
        }

        // packet length 확인
		if (receivedMsg.info.len != packet.length) {
		 	return;
		}

        let byte3Cmd = [0x82, 0x81, 0x83,]; // 환기, 가스
        let byte4Cmd = [0x81, 0x92,];  // 조명, 콘센트
        // 제어 요청에 대한 ack를 받았으면, 해당 명령의 callback 호출 후 명령큐에서 삭제
        let foundIdx = this._serialCmdQueue.findIndex(e => (e.cmdHex[1] == packet[1]) && ((byte3Cmd.includes(packet[2])) || (byte4Cmd.includes(packet[3]))));
        if (foundIdx > -1) {
            log(`Success command: ${this._serialCmdQueue[foundIdx].device}`);
            // 해당 명령에 callback이 정의되어 있으면 호출
            if (this._serialCmdQueue[foundIdx].callback) {
                this._serialCmdQueue[foundIdx].callback(receivedMsg);
            }
            this._serialCmdQueue.splice(foundIdx, 1);
            // updata to response
            var force = true;
        }

        // 메세지를 parsing 하여 property로 변환
        if (receivedMsg.info.parseToProperty) {
            var propArray = receivedMsg.info.parseToProperty(packet);
            for (var prop of propArray) {
                this.UpdateDeviceProperty(receivedMsg.info.device, prop.room_index, prop.propertyName, prop.propertyValue, force);
            }
        }
    }

    AddDeviceCommandToQueue(cmdHex, device, room_idx, propertyName, propertyValue, callback) {
        let now = new Date();
        var serialCmd = {
            cmdHex: cmdHex,
            device: device,
            room_idx: room_idx,
            property: propertyName,
            value: propertyValue,
            callback: callback,
            sentTime: now,
            retryCount: CONST.DEVICE_SEND_RETRY_COUNT
        };

        // 실행 큐에 저장
        log(`send to device: ${serialCmd.cmdHex.toString('hex')}`);
        this._serialCmdQueue.push(serialCmd);

        let elapsed = now - this._syncTime;
        let delay = (elapsed < 100) ? 100 - elapsed : 0;
        if (delay != 0) {
            error(`energy port sync message fail message ${elapsed} ms before / -> after ${delay} ms`)
        }

        setTimeout(this.ProcessSerialCommand.bind(this), delay);
    }

    ProcessSerialCommand() {
        if (this._serialCmdQueue.length == 0) return;

        var serialCmd = this._serialCmdQueue.shift();
        serialCmd.sentTime = new Date();

        if (serialCmd.retryCount != CONST.DEVICE_SEND_RETRY_COUNT) {
            log(`retrying send to device: ${serialCmd.cmdHex.toString('hex')}`);
        }

        switch (serialCmd.device) {
            // 디바이스별 write 정의
            case 'light': case 'outlet':
                this._socketWriteEnergy.write(serialCmd.cmdHex, (err) => { if (err) return error('send Error:', err.message); });
            case 'ventil': case 'gas': case 'thermostat':
                this._socketWriteControl.write(serialCmd.cmdHex, (err) => { if (err) return error('send Error:', err.message); });
        }

        if (serialCmd.retryCount > 0) {
            serialCmd.retryCount--;
            this._serialCmdQueue.push(serialCmd);
            setTimeout(this.ProcessSerialCommand.bind(this), CONST.DEVICE_SEND_RETRY_DELAY);

        } else {
            error(`maximum retrying ${CONST.DEVICE_SEND_RETRY_COUNT} times of command send exceeded`);
            if (serialCmd.callback) {
                serialCmd.callback.call(this,);
            }
        }
    }

    AddDevice(device, id, room_id, property) {
        var deviceStatus = {
            device: device,
            room_index: room_id,
            uri: '/bestin/' + id,
            property: (property ? property : {})
        };
        //log(`Adding new deviceStatus - ${JSON.stringify(deviceStatus)}`);
        this._deviceStatus.push(deviceStatus);
        return deviceStatus;
    }

    GetDeviceStatus(id, room_id) {
        var deviceFound = this._deviceStatus.find((e) => (e.device === id) && (e.room_index === Number(room_id)));
        if (!deviceFound) {
            throw new Error('no device found');
        }
        return deviceFound;
    }

    GetPropertyStatus(id, room_id, propertyName) {
        var property = {};
        property[propertyName] = this.GetDeviceStatus(id, room_id).property[propertyName];
        if (!property[propertyName]) {
            throw new Error('no command found');
        }
        return property;
    }

    SetDeviceProperty(device, room_idx, propertyName, propertyValue, callback) {
        var deviceMsg = this.GetDeviceStatus(device, room_idx).device;
        var msgInfo = CONST.MSG_INFO.find(e => ((e.setPropertyToMsg) && (e.device == device) && e.property.hasOwnProperty(propertyName)));

        if (!msgInfo) {
            if (deviceMsg == 'light') {
                if (room_idx == 1) { var lightNum = 3; } else { var lightNum = 2; };
                msgInfo = CONST.MSG_INFO.find(e => (e.device == 'light') && (e.property = propertyName));
            } else {
                warn(`no matching devices found - ${deviceMsg}/${room_idx}/${propertyName}`)
                return;
            }
        }
        //console.log(msgInfo);

        var cmdHex = Buffer.alloc(msgInfo.len);  // 버퍼 생성
        cmdHex[0] = 0x02
        cmdHex[1] = msgInfo.header
        cmdHex[2] = msgInfo.len
        cmdHex[3] = msgInfo.cmd;
        if (msgInfo.len == 10) {
            cmdHex[3] = this._timestamp;
        } else {
            cmdHex[4] = this._timestamp;
        }
        cmdHex = msgInfo.setPropertyToMsg(cmdHex, room_idx, propertyName, propertyValue);
        cmdHex[msgInfo.len - 1] = this.AddCheckSum(cmdHex); // 마지막 바이트는 체크섬

        //log(`Add to queue for applying new value - ${cmdHex.toString('hex')}`);
        this.AddDeviceCommandToQueue(cmdHex, device, room_idx, propertyName, propertyValue, callback);
    }

    UpdateDeviceProperty(device, room_idx, propertyName, propertyValue, force) {
        // 이전과 상태가 같으면 반영 중지
        let curPropertyValue = this._deviceStatusCache[device + room_idx + propertyName];
        if (!force && curPropertyValue && (propertyValue === curPropertyValue)) {
            return;
        }

        this._deviceStatusCache[device + room_idx + propertyName] = propertyValue;
        // 이전에 없던 device이면 새로 생성한다.
        let deviceStatus = this._deviceStatus.find(o => (o.device === device) && (o.room_index === room_idx));
        if (!deviceStatus) {
            var id = `${device}/${room_idx}`
            deviceStatus = this.AddDevice(device, id, room_idx);
        }
        // 상태 반영
        deviceStatus.property[propertyName] = propertyValue;
        //console.log(deviceStatus)

        // mqtt publish
        this.UpdateMqttDeviceStatus(device, room_idx, propertyName, propertyValue);
        // mqtt discovery
        this.DiscoveryPayload(device, room_idx, propertyName)
    }

    IparkLoginRequest() {
        const that = this;
        request.get(`http://${CONFIG.options.ipark.address}/webapp/data/getLoginWebApp.php?devce=WA&login_ide=${CONFIG.options.ipark.username}&login_pwd=${CONFIG.options.ipark.password}`,
            (error, response) => {
                if (response.statusCode === 200) {
                    log('Ipark server login successful');
                    that.CookieInfo(response);
                } else {
                    error(`Ipark server login falied with error code: ${error}`);
                    return;
                }
            })
    }

    CookieInfo(response) {
        const cookies = response.headers['set-cookie'];
        const cookieMap = cookies.reduce((acc, cookie) => {
            const [key, value] = cookie.split('=');
            acc[key] = value.split(';')[0];
            return acc;
        }, {});

        const cookieJson = {
            phpsessid: cookieMap['PHPSESSID'],
            userid: cookieMap['user_id'],
            username: cookieMap['user_name'],
        }

        if (!fs.existsSync('./cookie_info.json')) {
            fs.writeFileSync('./cookie_info.json', JSON.stringify(cookieJson), 'utf8');
            log('cookie_info.json file saved successfully');
        } else {
            log('already cookie_info.json file saved skip');
        }
    }

    ParseXML(xml, callback) {
        xml2js.parseString(xml, callback);
    }
    

}

_HomeRS485 = new HomeRS485();
