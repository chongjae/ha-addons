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
const CONFIG = require('./config.json');

// 로그 표시 
const log = (...args) => console.log('[' + (new Date()).toLocaleString() + ']', 'INFO     ', args.join(' '));
const warn = (...args) => console.log('[' + (new Date()).toLocaleString() + ']', 'WARNING  ', args.join(' '));
const error = (...args) => console.error('[' + (new Date()).toLocaleString() + ']', 'ERROR    ', args.join(' '));

const MSG_INFO = [
    /////////////////////////////////////////////////////////////////////////////
    //command <-> response
    {
        header: 0x31, cmd: 0x01, len: 13, req: 'set', device: 'light',
        setPropertyToMsg: (buf, roomIdx, name, value) => {
            let id = name.slice(5, 6);
            buf[5] = roomIdx & 0x0F;
            if (name.includes('power')) {
                buf[6] = ((0x01 << id - 1) | (value == 'on' ? 0x80 : 0x00));
                buf[11] = (value == 'on' ? 0x04 : 0x00);
            } else if (id == 'batch') {
                buf[6] = (value == 'on' ? 0x8F : 0x0F);
                buf[11] = (value == 'on' ? 0x04 : 0x00);
            }

            return buf;
        }
    },
    {
        header: 0x31, cmd: 0x81, len: 30, req: 'ack', device: 'light',
        parseToProperty: (buf) => {
            if ((buf[6] & 0x0F) == 0) {
                return [];
            } else {
                var propArr = [];
                let num = (buf[5] & 0x0F) == 1 ? 3 : 2;
                for (let i = 0; i < num; i++) {
                    propArr.push({
                        device: 'light',
                        roomIdx: buf[5] & 0x0F,
                        propertyName: 'power' + (i + 1),
                        propertyValue: ((buf[6] & (1 << i)) ? 'on' : 'off'),
                    }, {
                        device: 'light',
                        roomIdx: buf[5] & 0x0F,
                        propertyName: 'batch',
                        propertyValue: ((buf[6] & 0x0F) ? 'on' : 'off'),
                    });
                }
            }
            return propArr;
        }
    },

    {
        header: 0x28, cmd: 0x12, len: 14, req: 'set', device: 'thermostat',
        setPropertyToMsg: (buf, roomIdx, name, value) => {
            buf[5] = roomIdx & 0x0F;
            buf[6] = (value == 'heat' ? 0x01 : 0x02);

            return buf;
        }
    },
    {
        header: 0x28, cmd: 0x92, len: 16, req: 'ack', device: 'thermostat',
        parseToProperty: (buf) => {
            return [{
                device: 'thermostat', roomIdx: buf[5] & 0x0F, propertyName: 'mode',
                propertyValue: (buf[6] & 0x01) ? 'heat' : 'off'
            }];
        }
    },

    {
        header: 0x28, cmd: 0x12, len: 14, req: 'set', device: 'thermostat',
        setPropertyToMsg: (buf, roomIdx, name, value) => {
            buf[5] = roomIdx & 0x0F;
            value_int = parseInt(value);
            value_float = value - value_int;
            buf[7] = ((value_int & 0xFF) | ((value_float != 0) ? 0x40 : 0x00));

            return buf;
        }
    },
    {
        header: 0x28, cmd: 0x92, len: 16, req: 'ack', device: 'thermostat',
        parseToProperty: (buf) => {
            return [{
                device: 'thermostat', roomIdx: buf[5] & 0x0F, propertyName: 'setting',
                propertyValue: (buf[7] & 0x3F) + ((buf[7] & 0x40) > 0) * 0.5
            }];
        }
    },

    {
        header: 0x61, len: 10, req: 'set', device: 'ventil',
        setPropertyToMsg: (buf, roomIdx, name, value) => {
            if (name == 'power') {
                buf[2] = 0x01;
                buf[5] = (value == 'on' ? 0x01 : 0x00);
                buf[6] = 0x01;
            } else if (name == 'speed') {
                buf[2] = 0x03;
                buf[6] = Number(value);
            }

            return buf;
        }
    },
    {
        header: 0x61, cmd: 0x81, len: 10, req: 'ack', device: 'ventil',
        parseToProperty: (buf) => {
            var value = undefined;
            if (buf[5] == 0x00 || buf[5] == 0x01) {
                value = (buf[5] & 0x01) ? 'on' : 'off';
            } else {
                value = buf[6];
            }

            return [{ device: 'ventil', roomIdx: 1, propertyName: 'speed', propertyValue: value }];
        }
    },

    {
        header: 0x31, cmd: 0x02, len: 10, req: 'set', device: 'gas', property: { power: 'off' },
        setPropertyToMsg: (buf, roomIdx, name, value) => {

            return buf;
        }
    },
    {
        header: 0x31, cmd: 0x82, len: 10, req: 'ack', device: 'gas', property: { power: 'off' },
        parseToProperty: (buf) => {
            return [{ device: 'gas', roomIdx: 1, propertyName: 'power', propertyValue: 'off' }];
        }
    },

    /////////////////////////////////////////////////////////////////////////////
    //query <-> response
    {
        header: 0x31, cmd: 0x11, len: 7, req: 'get', device: 'light',
        setPropertyToMsg: (buf, roomIdx, name, value) => {
            buf[5] = roomIdx;

            return buf;
        }
    },
    {
        header: 0x31, cmd: 0x91, len: 30, req: 'ack', device: 'light',
        parseToProperty: (buf) => {
            var propArr = [];
            let num = (buf[5] & 0x0F) == 1 ? 3 : 2;
            for (let i = 0; i < num; i++) {
                propArr.push({
                    device: 'light', roomIdx: buf[5] & 0x0F, propertyName: 'power' + (i + 1),
                    propertyValue: ((buf[6] & (1 << i)) ? 'on' : 'off')
                }, {
                    device: 'light', roomIdx: buf[5] & 0x0F, propertyName: 'batch',
                    propertyValue: ((buf[6] & 0x0F) ? 'on' : 'off')
                });
            }

            return propArr;
        }
    },

    {
        header: 0x31, cmd: 0x91, len: 30, req: 'ack', device: 'outlet',
        parseToProperty: (buf) => {
            var propArr = [];
            let num = (buf[5] & 0x0F) == 1 ? 3 : 2;
            for (let i = 0; i < num; i++) {
                propArr.push({
                    device: 'outlet', roomIdx: buf[5] & 0x0F, propertyName: 'power' + (i + 1),
                    propertyValue: ((buf[6] & (1 << i)) ? 'on' : 'off')
                }, {
                    device: 'outlet', roomIdx: buf[5] & 0x0F, propertyName: 'standby',
                    propertyValue: ((buf[7] >> 4) ? 'on' : 'off')
                });
            }

            return propArr;
        }
    },

    {
        header: 0x28, cmd: 0x11, len: 7, req: 'get', device: 'thermostat',
        setPropertyToMsg: (buf, roomIdx, name, value) => {
            buf[5] = roomIdx;

            return buf;
        }
    },
    {
        header: 0x28, cmd: 0x91, len: 16, req: 'ack', device: 'thermostat',
        parseToProperty: (buf) => {
            return [{
                device: 'thermostat', roomIdx: buf[5] & 0x0F, propertyName: 'mode',
                propertyValue: (buf[6] & 0x01) ? 'heat' : 'off'
            }, {
                device: 'thermostat', roomIdx: buf[5] & 0x0F, propertyName: 'setting',
                propertyValue: (buf[7] & 0x3F) + ((buf[7] & 0x40) > 0) * 0.5
            }, {
                device: 'thermostat', roomIdx: buf[5] & 0x0F, propertyName: 'current',
                propertyValue: (buf[8] << 8 | buf[9]) / 10
            }];
        }
    },

    {
        header: 0x61, cmd: 0x00, len: 10, req: 'get', device: 'ventil',
        setPropertyToMsg: (buf, roomIdx, name, value) => {

            return buf;
        }
    },
    {
        header: 0x61, cmd: 0x80, len: 10, req: 'ack', device: 'ventil',
        parseToProperty: (buf) => {
            return [{
                device: 'ventil', roomIdx: 1, propertyName: 'power', propertyValue: (buf[5] ? 'on' : 'off')
            }, {
                device: 'ventil', roomIdx: 1, propertyName: 'speed', propertyValue: buf[6]
            }];
        }
    },

    {
        header: 0x31, cmd: 0x00, len: 10, req: 'get', device: 'gas',
        setPropertyToMsg: (buf, roomIdx, name, value) => {

            return buf;
        }
    },
    {
        header: 0x31, cmd: 0x80, len: 10, req: 'ack', device: 'gas',
        parseToProperty: (buf) => {

            return [{ device: 'gas', roomIdx: 1, propertyName: 'power', propertyValue: (buf[5] ? 'on' : 'off') }];
        }
    },

    {
        header: 0xD1, cmd: 0x02, len: 7, req: 'get', device: 'energy',
        setPropertyToMsg: (buf, roomIdx, name, value) => {

            return buf;
        }
    },
    {
        header: 0xD1, cmd: 0x82, len: 48, req: 'ack', device: 'energy',
        parseToProperty: (buf) => {
            const idx = { electric: 13, heat: 21, hotwater: 29, gas: 37, water: 45 };
            const convert = (idx, buf) => {
                return ((buf[idx].toString(16)).padStart(2, '0') + (buf[idx + 1].toString(16)).padStart(2, '0'));
            }
            var propArr = [];
            for (let name in idx) {
                consumption = convert(idx[name], buf);
                propArr.push({ device: 'energy', roomIdx: name, propertyName: 'current', propertyValue: consumption });
            }

            return propArr;
        }
    },

]

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
        this._msgPrefix = [0x02];
        this._msgHeader = [0x31, 0x41, 0x42, 0xd1, 0x28, 0x61, 0xc1];
    }

    _transform(chunk, encoding, done) {
        let start = 0;
        for (let i = 0; i < chunk.length; i++) {
            if (this._msgPrefix.includes(chunk[i]) && this._msgHeader.includes(chunk[i + 1])) {
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
        const { energy_port, control_port } = CONFIG.options;
        this._socketWriteEnergy = this.createSocketConnection(energy_port, 'energy');
        this._socketWriteControl = this.createSocketConnection(control_port, 'control');
        this._iparkServerInfo = this.IparkLoginRequest();
    }

    MqttClient() {
        const client = mqtt.connect('mqtt://' + CONFIG.options.mqtt.broker, {
            port: CONFIG.options.mqtt.port,
            username: CONFIG.options.mqtt.username,
            password: CONFIG.options.mqtt.password,
            clientId: 'BESTIN_WALLPAD',
        });

        client.on('connect', () => {
            log("MQTT connection successful!");
            const topics = ['bestin/+/+/+/command', 'homeassistant/status'];
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
            if (topics[0] === CONFIG.options.mqtt.topic_prefix) {
                // mqtt 토픽 변환
                this.SetDeviceProperty(topics[1], topics[2], topics[3], value);
            }
        } else {
            warn('mqtt is not ready. wait..');
        }
    }

    UpdateMqttDeviceStatus(device, roomIdx, propertyName, propertyValue) {

        const topic = util.format('bestin/%s/%s/%s/state', device, roomIdx, propertyName);
        // 현재전력/온도는 로깅 제외
        if (propertyName != 'current') {
            log('publish mqtt:', topic, '=', propertyValue);
        }
        this._mqttClient.publish(topic, String(propertyValue));
    }

    DiscoveryPayload(device, roomIdx, propertyName) {
        let topic;
        let payload;

        switch (device) {
            case 'light':
                topic = `homeassistant/light/bestin_wallpad/light_${roomIdx}/config`;
                payload = {
                    name: `bestin_light_${roomIdx}_${propertyName}`,
                    cmd_t: `bestin/light/${roomIdx}/${propertyName}/command`,
                    stat_t: `bestin/light/${roomIdx}/${propertyName}/state`,
                    uniq_id: `light_${roomIdx}_${propertyName}`,
                    pl_on: 'on',
                    pl_off: 'off',
                    //opt: true,
                }
                break;
            case 'thermostat':
                topic = `homeassistant/climate/bestin_wallpad/thermostat_${roomIdx}/config`;
                payload = {
                    name: `bestin_thermostat_${roomIdx}`,
                    mode_cmd_t: `bestin/thermostat/${roomIdx}/mode/command`,
                    mode_stat_t: `bestin/thermostat/${roomIdx}/mode/state`,
                    temp_cmd_t: `bestin/thermostat/${roomIdx}/setting/command`,
                    temp_stat_t: `bestin/thermostat/${roomIdx}/setting/state`,
                    curr_temp_t: `bestin/thermostat/${roomIdx}/current/state`,
                    preset_mode_command_topic: `bestin/thermostat/${roomIdx}/mode/command`,
                    preset_mode_state_topic: `bestin/thermostat/${roomIdx}/mode/state`,
                    uniq_id: `thermostat_${roomIdx}`,
                    modes: ['off', 'heat'],
                    preset_modes: ['off', 'pause'],
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
                    pr_modes: ['1', '2', '3'],
                    uniq_id: `vnetil_1`,
                    pl_on: 'on',
                    pl_off: 'off',
                }
                break;
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
                }
                break;
        }
        this.MqttDiscovery(topic, payload);
    }

    MqttDiscovery(topic, payload) {
        payload = {
            ids: ["bestin_wallpad"],
            name: "bestin_wallpad",
            mf: "HDC BESTIN",
            mdl: "HDC BESTIN Wallpad",
            sw: "harwin1/bestin-v1/bestin-new",
        };
        this._mqttClient.publish(String(topic), JSON.stringify(payload), { qos: 2 });

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
            log(`Successfully opened ${name} port: ${options.ser_path}`);
            setTimeout(() => {
                this._deviceReady = true;
                log(`serial-${name} service ready...`)
                // device connect 딜레이
            }, 2000);
        });
        connection.on('close', () => {
            warn(`closed ${name} port: ${options.ser_path}`);
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
            }, 2000);
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
        // let receivedMsg = this._receivedMsgs.find(e => e.codeHex.equals(packet));
        let receivedMsg = null;
        let foundMsgInfo = null;
        if (!receivedMsg) {
            isNew = true;
            foundMsgInfo = MSG_INFO.find(e => e.header == packet[1] && String(e.cmd).includes(packet[3]));
            if (!foundMsgInfo) {
                foundMsgInfo = MSG_INFO.find(e => e.header == packet[1] && String(e.cmd).includes(packet[2]));
            }

            receivedMsg = {
                code: packet.toString('hex'),
                codeHex: packet,
                count: 0,
                info: foundMsgInfo,
            };
            receivedMsg.checksum = this.VerifyCheckSum(packet);
            this._receivedMsgs.push(receivedMsg);
        }
        //console.log(receivedMsg)

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
        // if (receivedMsg.info.len != packet.length) {
        //    return;
        // }

        let byte3Cmd = [0x82, 0x81, 0x83,]; // 환기, 가스
        let byte4Cmd = [0x81, 0x92, 0xA2];  // 조명, 콘센트, 난방
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
                this.UpdateDeviceProperty(receivedMsg.info.device, prop.roomIdx, prop.propertyName, prop.propertyValue, force);
            }
        }
    }

    AddDeviceCommandToQueue(cmdHex, device, roomIdx, name, value, callback) {
        let now = new Date();
        var serialCmd = {
            cmdHex: cmdHex,
            device: device,
            roomIdx: roomIdx,
            property: propertyName,
            value: propertyValue,
            callback: callback,
            sentTime: now,
            retryCount: CONFIG.options.retry_count
        };

        // 실행 큐에 저장
        log(`send to device: ${serialCmd.cmdHex.toString('hex')}`);
        this._serialCmdQueue.push(serialCmd);

        let elapsed = now - this._syncTime;
        let delay = (elapsed < 100) ? 100 - elapsed : 0;
        if (delay != 0) {
            //warn()
        }

        setTimeout(this.ProcessSerialCommand.bind(this), delay);
    }

    ProcessSerialCommand() {
        if (this._serialCmdQueue.length == 0) return;

        var serialCmd = this._serialCmdQueue.shift();
        serialCmd.sentTime = new Date();

        if (serialCmd.retryCount != CONFIG.options.retry_delay) {
            //log(`retrying send to device: ${serialCmd.cmdHex.toString('hex')}`);
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
            setTimeout(this.ProcessSerialCommand.bind(this), CONFIG.options.retry_delay);

        } else {
            error(`maximum retrying ${CONFIG.options.retry_count} times of command send exceeded`);
            if (serialCmd.callback) {
                serialCmd.callback.call(this,);
            }
        }
    }

    AddDevice(device, roomIdx, property) {
        var deviceStatus = {
            device: device,
            roomIdx: roomIdx,
            property: (property ? property : {})
        };
        //log(`Adding new deviceStatus - ${JSON.stringify(deviceStatus)}`);
        this._deviceStatus.push(deviceStatus);
        return deviceStatus;
    }

    SetDeviceProperty(device, roomIdx, propertyName, propertyValue, callback) {
        var msgInfo = MSG_INFO.find(e => ((e.setPropertyToMsg) && (e.device == device)));
        if (!msgInfo) {
            warn(`unknown device: ${device}`);
            return;
        }
        if (!msgInfo.device.includes(device)) {
            warn(`unknown command: ${propertyName}`);
            return;
        }
        if (!propertyValue) {
            warn(`no payload value: ${propertyValue}`);
            return;
        }

        var cmdHex = Buffer.alloc(msgInfo.len);  // 버퍼 생성
        cmdHex[0] = 0x02
        cmdHex[1] = msgInfo.header
        cmdHex[2] = msgInfo.len;
        cmdHex[3] = msgInfo.cmd;
        if (msgInfo.len == 10) {
            cmdHex[3] = this._timestamp;
        } else {
            cmdHex[4] = this._timestamp;
        }
        cmdHex = msgInfo.setPropertyToMsg(cmdHex, roomIdx, propertyName, propertyValue);
        cmdHex[msgInfo.len - 1] = this.AddCheckSum(cmdHex); // 마지막 바이트는 체크섬

        //log(`Add to queue for applying new value - ${cmdHex.toString('hex')}`);
        this.AddDeviceCommandToQueue(cmdHex, device, roomIdx, propertyName, propertyValue, callback);
    }

    UpdateDeviceProperty(device, roomIdx, propertyName, propertyValue, force) {
        //console.log(`Update device property: ${device}, ${roomIdx}, ${name}, ${value}`)
        // 이전과 상태가 같으면 반영 중지
        let curPropertyValue = this._deviceStatusCache[device + roomIdx + propertyName];
        if (!force && curPropertyValue && (propertyValue == curPropertyValue)) {
            return;
        }

        this._deviceStatusCache[device + roomIdx + propertyName] = propertyValue;
        // 이전에 없던 device이면 새로 생성한다.
        let deviceStatus = this._deviceStatus.find(o => (o.device === device) && (o.roomIdx === roomIdx));
        if (!deviceStatus) {
            deviceStatus = this.AddDevice(device, roomIdx);
        }
        // 상태 반영
        deviceStatus.property[propertyName] = propertyValue;
        //console.log(deviceStatus)

        // mqtt publish
        this.UpdateMqttDeviceStatus(device, roomIdx, propertyName, propertyValue);

        // mqtt discovery
        if (CONFIG.options.mqtt.discovery_register) {
            this.DiscoveryPayload(device, roomIdx, propertyName)
        }
    }

    IparkLoginRequest() {
        const that = this;
        request.get(`http://${CONFIG.options.ipark_server.address}/webapp/data/getLoginWebApp.php?devce=WA&login_ide=${CONFIG.options.ipark_server.username}&login_pwd=${CONFIG.options.ipark_server.password}`,
            (error, response) => {
                if (response.statusCode === 200) {
                    log('IPARK server login successful');
                    that.CookieInfo(response);
                } else {
                    error(`IPARK server login falied with error code: ${error}`);
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
