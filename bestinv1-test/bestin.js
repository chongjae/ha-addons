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
const warn = (...args) => console.warn('[' + (new Date()).toLocaleString() + ']', 'WARNING  ', args.join(' '));
const error = (...args) => console.error('[' + (new Date()).toLocaleString() + ']', 'ERROR    ', args.join(' '));

const CONST = {
    // 시리얼 전송 설정
    DEVICE_READY_DELAY: 5000,
    DEVICE_SEND_RETRY_DELAY: CONFIG.options.retry_delay,
    DEVICE_SEND_RETRY_COUNT: CONFIG.options.retry_count,
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

        // 제어
        // 조명 제어
        {
            header: 0x02310D01, len: 13, req: 'set', type: 'light', property: {},
            setPropertyToMsg: (buf, room_idx, name, value) => {
                let idx = name.slice(5, 6);
                buf[5] = room_idx & 0x0f;
                if (name.includes('power')) {
                    buf[6] = ((0x01 << idx - 1) | (value == 'on' ? 0x80 : 0x00));
                    buf[11] = (value == 'on' ? 0x04 : 0x00);
                } else if (name == 'batch') {
                    buf[6] = (value == 'on' ? 0x8f : 0x0f);
                    buf[11] = (value == 'on' ? 0x04 : 0x00);
                }

                return buf;
            }
        },


        // 조명 제어 응답
        {
            header: 0x02311E81, len: 30, req: 'ack', type: 'light', property: {},
            parseToProperty: (buf) => {
                if ((buf[6] & 0x0f) == 0) {
                    return [];
                } else {
                    return [
                        { device: 'light', room_index: buf[5] & 0x0f, propertyName: 'power' + (buf[6] & 0x0f), propertyValue: (buf[6] ? 'on' : 'off') },
                        { device: 'light', room_index: buf[5] & 0x0f, propertyName: 'batch', propertyValue: (buf[6] ? 'on' : 'off') },
                    ];
                }
            }
        },

        // 콘센트 제어
        {
            header: 0x02310D01, len: 13, req: 'set', type: 'outlet', property: {},
            setPropertyToMsg: (buf, room_idx, name, value) => {
                let idx = name.slice(5, 6);
                buf[5] = room_idx & 0x0f;
                if (name.includes('power')) {
                    buf[7] = ((0x01 << idx - 1) | (value == 'on' ? 0x80 : 0x00));
                    buf[11] = (value == 'on' ? (0x09 << idx - 1) : 0x00);
                } else if (name == 'standby') {
                    buf[8] = (value == 'on' ? 0x83 : 0x03);
                } else if (name == 'batch') {
                    buf[6] = (value == 'on' ? 0x8f : 0x0f);
                    buf[11] = (value == 'on' ? 0x12 : 0x00);
                }

                return buf;
            }
        },

        // 콘센트 제어 응답
        {
            header: 0x02311E81, len: 30, req: 'ack', type: 'outlet', property: {},
            parseToProperty: (buf) => {
                if ((buf[7] & 0x0f) == 0) {
                    return [];
                } else {
                    return [
                        { device: 'outlet', room_index: buf[5] & 0x0f, propertyName: 'power' + (buf[7] & 0x0f), propertyValue: (buf[7] ? 'on' : 'off') },
                        { device: 'outlet', room_index: buf[5] & 0x0f, propertyName: 'standby', propertyValue: ((buf[7] >> 4) ? 'on' : 'off') },
                    ];
                }
            }
        },

        // 난방 모드 제어
        {
            header: 0x02280E12, len: 14, req: 'set', type: 'thermostat', property: { mode: 'off' },
            setPropertyToMsg: (buf, room_idx, name, value) => {
                if (value == 'fan_only') {
                    buf[8] = 0x77
                    buf[9] = 0x77
                    buf[10] = 0x07
                } else {
                    buf[5] = room_idx & 0x0f;
                    buf[6] = (value == 'heat' ? 0x01 : 0x02);
                }

                return buf;
            }
        },
        // 난방 모드 응답
        {
            header: 0x02281092, len: 16, req: 'ack', type: 'thermostat', property: { mode: 'off' },
            parseToProperty: (buf) => {
                let room_idx = buf[5] & 0x0f;
                return [
                    { device: 'thermostat', room_index: room_idx, propertyName: 'mode', propertyValue: (buf[6] ? 'heat' : 'off') },
                    //{ deviceId: deviceId, propertyName: 'setTemp', propertyValue: buf[4] },
                    //{ deviceId: deviceId, propertyName: 'curTemp', propertyValue: buf[5] },
                ];
            }
        },

        // 난방 온도 제어
        {
            header: 0x02280E12, len: 14, req: 'set', type: 'thermostat', property: { setting: 0 },
            setPropertyToMsg: (buf, room_idx, name, value) => {
                buf[5] = room_idx & 0x0f;
                value_int = parseInt(value);
                value_float = value - value_int;
                buf[7] = ((value_int & 0xff) | ((value_float != 0) ? 0x40 : 0x00));

                return buf;
            }
        },
        // 난방 온도 제어 응답
        {
            header: 0x02281092, len: 16, req: 'ack', type: 'thermostat', property: { setting: 0 },
            parseToProperty: (buf) => {
                let room_idx = buf[5] & 0x0f
                return [
                    { device: 'thermostat', room_index: room_idx, propertyName: 'setting', propertyValue: (buf[7]&0x3f)+((buf[7]&0x40)>0)*0.5 },
                ];
            }
        },

        // 환기 제어
        {
            header: 0x026100, len: 10, req: 'set', type: 'ventil', property: { power: 'off', speed: 1 },
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
        // 환기 제어 응답
        {
            header: 0x026100, len: 10, req: 'ack', type: 'ventil', property: { power: 'off', speed: 1 },
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

        // 가스밸브 제어
        {
            header: 0x023102, len: 10, req: 'set', type: 'gas', property: { power: 'off' },
            setPropertyToMsg: (buf, room_idx, name, value) => {

                return buf;
            }
        },
        {
            header: 0x023182, len: 10, req: 'ack', type: 'gas', property: { power: 'off' },
            parseToProperty: (buf) => {
                return [{ device: 'gas', room_index: 1, propertyName: 'power', propertyValue: 'off' }];
            }
        },

        /////////////////////////////////////////////////////////////////////////////
        // 상태 조회
        // 조명 상태
        {
            header: 0x02310711, len: 7, req: 'get', type: 'light', property: {},
            setPropertyToMsg: (buf, room_idx, name, value) => {
                buf[5] = room_idx

                return buf;
            }
        },
        // 조명 상태 응답
        {
            header: 0x02311E91, len: 30, req: 'ack', type: 'light', property: {},
            parseToProperty: (buf) => {
                var propArr = [];
                for (let i = 0; i < 3; i++) {
                    propArr.push(
                        { device: 'light', room_index: buf[5] & 0x0f, propertyName: 'power' + (i + 1), propertyValue: ((buf[6] & (1 << i)) ? 'on' : 'off') },
                        { device: 'light', room_index: buf[5] & 0x0f, propertyName: 'batch', propertyValue: ((buf[6] & 0x0f) ? 'on' : 'off') }
                    );
                }

                return propArr;
            }
        },

        // 콘센트 상태
        {
            header: 0x02310711, len: 7, req: 'get', type: 'outlet', property: {},
            setPropertyToMsg: (buf, room_idx, name, value) => {
                buf[5] = room_idx

                return buf;
            }
        },
        // 콘센트 상태 응답
        {
            header: 0x02311E91, len: 30, req: 'ack', type: 'outlet', property: {},
            parseToProperty: (buf) => {
                var propArr = [];
                for (let i = 0; i < 3; i++) {
                    propArr.push(
                        { device: 'outlet', room_index: buf[5] & 0x0f, propertyName: 'power' + (i + 1), propertyValue: ((buf[7] & (1 << i)) ? 'on' : 'off') },
                        { device: 'outlet', room_index: buf[5] & 0x0f, propertyName: 'standby', propertyValue: ((buf[7] >> 4) ? 'on' : 'off') },
                    )
                }

                return propArr;
            }
        },

        // 난방 상태
        {
            header: 0x02280711, len: 7, req: 'get', type: 'thermostat', property: { mode: 'off', setting: 0, current: 0 },
            setPropertyToMsg: (buf, room_idx, name, value) => {
                buf[5] = room_idx

                return buf;
            }
        },
        // 난방 상태 응답
        {
            header: 0x02281091, len: 16, req: 'ack', type: 'thermostat', property: { mode: 'off', setting: 0, current: 0 },
            parseToProperty: (buf) => {
                let room_idx = buf[5] & 0x0f
                return [
                    { device: 'thermostat', room_index: room_idx, propertyName: 'mode', propertyValue: buf[6] == 0x07 ? 'fan_only' : ((buf[6] & 0x01) ? "heat" : "off") },
                    { device: 'thermostat', room_index: room_idx, propertyName: 'setting', propertyValue: (buf[7]&0x3f)+((buf[7]&0x40)>0)*0.5 },
                    { device: 'thermostat', room_index: room_idx, propertyName: 'current', propertyValue: (buf[8]<<8|buf[9])/10 },
                ];
            }
        },

        // 환기 상태
        {
            header: 0x026100, len: 10, req: 'get', type: 'ventil', property: { power: 'off', speed: 1 },
            setPropertyToMsg: (buf, room_idx, name, value) => {

                return buf;
            }
        },
        // 환기 상태 응답
        {
            header: 0x026181, len: 10, req: 'ack', type: 'ventil', property: { power: 'off', speed: 1 },
            parseToProperty: (buf) => {
                return [
                    { device: 'ventil', room_index: 1, propertyName: 'power', propertyValue: ((buf[5] & 0x01) ? 'on' : 'off') },
                    { device: 'ventil', room_index: 1, propertyName: 'speed', propertyValue: buf[6] },
                ];
            }
        },

        // 가스밸브 상태
        {
            header: 0x023100, len: 10, req: 'get', type: 'gas', property: { power: 'off' },
            setPropertyToMsg: (buf, room_idx, name, value) => {

                return buf;
            }
        },
        // 가스밸브 상태 응답
        {
            header: 0x023180, len: 10, req: 'ack', type: 'gas', property: { power: 'off' },
            parseToProperty: (buf) => {

                return [{ device: 'gas', room_index: 1, propertyName: 'power', propertyValue: ((buf[5] & 0x01) ? 'on' : 'off') }];
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
        this._msgTypeFlag = false;
    }

    _transform(chunk, encoding, done) {
        let start = 0;
        for (let i = 0; i < chunk.length; i++) {
            if (CONST.MSG_PREFIX.includes(chunk[i]) && CONST.MSG_HEADERS.includes(chunk[i + 1])) {
                this.pushBuffer();
                start = i;
                this._msgTypeFlag = true;
            } else if (this._msgTypeFlag) {
                this._msgLength = chunk[i + 1] + 1;
                this._msgTypeFlag = false;
                if (!this._msgLength > 6) {
                    this.reset();
                    return done(new Error('Invalid message length'));
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
        this.push(Buffer.concat(this._queueChunk));
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
        const { energy, control } = CONFIG.options;
        this._socketWriteEnergy = this.createSocketConnection(energy, 'energy');
        this._socketWriteControl = this.createSocketConnection(control, 'control');
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

        client.on('message', this.MqttCmdHandle.bind(this));
        return client;
    }

    MqttCmdHandle(topic, message) {
        if (this._deviceReady) {
            var topics = topic.split('/');
            var value = message.toString(); 
            if (topics[0] === CONST.TOPIC_PRFIX) {
                this.SetDeviceProperty(topics[1], topics[2], topics[3], value);
            }
        } else {
            warn('mqtt is not ready... drop message...');
        }
    }

    UpdateMqttDeviceStatus(device, room_idx, propertyName, propertyValue) {
        const topic = util.format(CONST.STATE_TOPIC, device, room_idx, propertyName);  
        if (propertyName != 'current') {
            log('publish mqtt :', topic, '=', propertyValue);
        }
        this._mqttClient.publish(topic, String(propertyValue), { retain: true });
    }

    VerifyCheckSum(packet) {
        let result = 0x03;
        for (let i = 0; i < packet.length; i++) {
            result ^= packet[i];
            result = (result + 1) & 0xff;
        }
        return result;
    }

    AddCheckSum(packet) {
        let result = 0x03;
        for (let i = 0; i < packet.length -1; i++) {
            result ^= packet[i];
            result = (result + 1) & 0xff;
        }
        return result;
    }

    /*
    createConn(name) {
        const { energy, control } = CONFIG.options;
        let connection;
        //let name;

        if (energy) {
            name = 'energy';
            connection = this.createSocketConnection(energy, name);
        }
        if (control) {
            name = 'control';
            connection = this.createSocketConnection(control, name);
        }

        return connection;
    }
    */

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
            }, CONST.DEVICE_READY_DELAY);
        });
        connection.on('close', () => {
            warn(`Closed ${name} port: ${options.serPath}`);
        });
        connection.open((err) => {
            if (err) {
                error(`Failed to open ${name} port: ${err.message}`);
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
            }, CONST.DEVICE_READY_DELAY);
        });
        connection.on('error', (err) => {
            error(`Connection error ${err.code}::${name.toUpperCase()}. Attempting to reconnect...`);
            connection.connect(options.port, options.addr);
        });
        connection.pipe(new CustomParser()).on('data', this.PacketHandle.bind(this));

        return connection;
    }

    PacketHandle(packet) {
        //console.log(packet.toString('hex'))
        let isNew = false;
        this._lastReceive = new Date();

        if (packet[0] == 0x02 && packet[1] == 0x41) {
            this._syncTime = this._lastReceive;
            this._timestamp = parseInt(packet.slice(4, 5).toString('hex'), 16);
        }
        let receivedMsg = this._receivedMsgs.find(e => e.codeHex.equals(packet));
        console.log(receivedMsg)
        if (!receivedMsg) {
            isNew = true;
            var foundMsgInfo = CONST.MSG_INFO.find((e) =>
                e.len == packet.length &&
                e.type.includes(device)
            );
            if (!foundMsgInfo) {
                //warn('foundMsgInfo not found packet to message return');
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
            warn(`checksum is not match. ${'0x' + receivedMsg.checksum.toString(16)}`);
            return;
        }
        if (!receivedMsg.info) {
            //warn("drop Unmanaged message - " + receivedMsg.code);
            return;
        }
        //if (receivedMsg.info.len != packet.length) {
            //warn(`packet length is not match. ${'expected-' + receivedMsg.info.len, 'real value-' + packet.length}`);
		 	//return;
        //}
        let byte3Cmd = [0x82, 0x81, 0x83];
        let byte4Cmd = [0x81, 0x92];
        let foundIdx = this._serialCmdQueue.findIndex(e => (e.cmdHex[1] == packet[1]) && ((byte3Cmd.includes(packet[2])) || (byte4Cmd.includes(packet[3]))));
        if (foundIdx > -1) {
            log('Success command:', this._serialCmdQueue[foundIdx].device);
            if (this._serialCmdQueue[foundIdx].callback) {
                this._serialCmdQueue[foundIdx].callback(receivedMsg);
            }
            this._serialCmdQueue.splice(foundIdx, 1);
            var force = true;
        }

        if (receivedMsg.info.parseToProperty) {
            var propArray = receivedMsg.info.parseToProperty(packet);
            for (var prop of propArray) {
                this.UpdateDeviceProperty(receivedMsg.info.type, prop.device, prop.room_index, prop.propertyName, prop.propertyValue, force);
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
        log('send to device:', serialCmd.cmdHex.toString('hex'));
        this._serialCmdQueue.push(serialCmd);

        let elapsed = now - this._syncTime;
        let delay = (elapsed < 100) ? 100 - elapsed : 0;
        if (delay != 0) {
            //error('sync message occured ' + elapsed + 'ms ago. In order to prevent confliction, send message after ' + delay + 'ms.');
        }
        setTimeout(this.ProcessSerialCommand.bind(this), delay);
    }

    ProcessSerialCommand() {
        if (this._serialCmdQueue.length == 0) return;

        var serialCmd = this._serialCmdQueue.shift();
        serialCmd.sentTime = new Date();

        if (serialCmd.retryCount != CONST.DEVICE_SEND_RETRY_COUNT) {
            //warn('retrying send to device:', serialCmd.cmdHex.toString('hex'));
        }
        switch (serialCmd.device) {
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
            let errorMsg = 'no response after retrying ' + CONST.DEVICE_SEND_RETRY_COUNT + ' times.';
            error(errorMsg);
            if (serialCmd.callback) {
                serialCmd.callback.call(this,);
            }
        }
    }

    AddDevice(type, id, room_id, property) {
        var deviceStatus = {
            type: type,
            room_index: room_id,
            uri: '/bestin/' + id,
            property: (property ? property : {})
        };
        log('Adding new deviceStatus - ' + JSON.stringify(deviceStatus));
        this._deviceStatus.push(deviceStatus);
        return deviceStatus;
    }

    GetDeviceStatus(id, room_id) {
        var deviceFound = this._deviceStatus.find((e) => (e.type === id) && (e.room_index == room_id));
        if (!deviceFound) {
            throw new Error('no device found');
        }
        return deviceFound;
    }

    GetPropertyStatus(id, room_id, propertyName) {
        var property = {};
        property[propertyName] = this.GetDeviceStatus(id, room_id).property[propertyName];
        if (!property[propertyName]) {
            throw new Error('no property found');
        }
        return property;
    }

    SetDeviceProperty(device, room_idx, propertyName, propertyValue, callback) {
        log('SetDeviceProperty', device, '/', room_idx, '/', propertyName, '=', propertyValue);

        var type = this.GetDeviceStatus(device, room_idx).type;
        //console.log(type)
        var msgInfo = CONST.MSG_INFO.find(e => ((e.setPropertyToMsg) && (e.type == type) && e.property.hasOwnProperty(propertyName)));
        if (!msgInfo) {
            if (type == 'light' || 'outlet') {
                msgInfo = CONST.MSG_INFO.find(e => ((e.setPropertyToMsg) && (e.type == type) && (e.property = propertyName)));
                //console.log(msgInfo)
            } else {
                warn('There is no message info regarding to type : ' + type + ', room_index : ' + room_idx, ', propertyName : ' + propertyName);
                return;
            }
        }

        //log('msgInfo : ' + JSON.stringify(msgInfo));
        var cmdHex = Buffer.alloc(msgInfo.len);
        if (msgInfo.header.toString(16).length == 5) {
            cmdHex.writeUIntBE(msgInfo.header, 0, 3);
            cmdHex[3] = this._timestamp;
        } else if (msgInfo.header.toString(16).length == 7) {
            cmdHex.writeUIntBE(msgInfo.header, 0, 4);
            cmdHex[4] = this._timestamp;
        }
        cmdHex = msgInfo.setPropertyToMsg(cmdHex, room_idx, propertyName, propertyValue);
        cmdHex[msgInfo.len - 1] = this.AddCheckSum(cmdHex);

        log('Add to queue for applying new value. - ' + cmdHex.toString('hex'));
        this.AddDeviceCommandToQueue(cmdHex, device, room_idx, propertyName, propertyValue, callback);

        //this.UpdateDeviceProperty(type, deviceId, propertyName, propertyValue);	
    }

    UpdateDeviceProperty(type, device, room_idx, propertyName, propertyValue, force) {
        let curPropertyValue = this._deviceStatusCache[device + room_idx + propertyName];
        if (!force && curPropertyValue && (propertyValue === curPropertyValue)) {
            //log('the status is same as before... skip...');
            return;
        }
        //log('UpdateDeviceStatus: type:' + type + ', room_index:' + room_idx + ', propertyName:' + propertyName + ', propertyValue:' + propertyValue);

        this._deviceStatusCache[device + room_idx + propertyName] = propertyValue;
        let deviceStatus = this._deviceStatus.find(o => (o.type === device) && (o.room_index === room_idx));
        if (!deviceStatus) {
            var id = `${device}/${room_idx}`
            deviceStatus = this.AddDevice(type, id, room_idx);
        }
        deviceStatus.property[propertyName] = propertyValue;
        this.UpdateMqttDeviceStatus(device, room_idx, propertyName, propertyValue);
    }
}

_HomeRS485 = new HomeRS485();

