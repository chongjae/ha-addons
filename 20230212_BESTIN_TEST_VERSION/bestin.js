/** 
 * @fileoverview bestin.js
 * @description bestin.js
 * @version 1.0.0
 * @license MIT
 * @author harwin1
 * @date 2023-02-12
 * @lastUpdate 2023-02-12
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
        header: 0x61, cmd: [0x81, 0x83], len: 10, req: 'ack', device: 'ventil',

    },

    {
        header: 0x31, cmd: 0x02, len: 10, req: 'set', device: 'gas',
        setPropertyToMsg: (buf, roomIdx, name, value) => {

            return buf;
        }
    },
    {
        header: 0x31, cmd: 0x82, len: 10, req: 'ack', device: 'gas',

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
                    device: 'light',
                    roomIdx: buf[5] & 0x0F,
                    propertyName: 'power' + (i + 1),
                    propertyValue: ((buf[6] & (1 << i)) ? 'on' : 'off'),
                },
                    {
                        device: 'light',
                        roomIdx: buf[5] & 0x0F,
                        propertyName: 'batch',
                        propertyValue: ((buf[6] & 0x0F) ? 'on' : 'off'),
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
                    device: 'outlet',
                    roomIdx: buf[5] & 0x0F,
                    propertyName: 'power' + (i + 1),
                    propertyValue: ((buf[6] & (1 << i)) ? 'on' : 'off'),
                },
                    {
                        device: 'outlet',
                        roomIdx: buf[5] & 0x0F,
                        propertyName: 'standby',
                        propertyValue: ((buf[7] >> 4) ? 'on' : 'off'),
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
            return [
                { device: 'thermostat', roomIdx: buf[5] & 0x0F, propertyName: 'mode', propertyValue: (buf[6] & 0x01) ? 'heat' : 'off' },
                { device: 'thermostat', roomIdx: buf[5] & 0x0F, propertyName: 'setting', propertyValue: (buf[7] & 0x3F) + ((buf[7] & 0x40) > 0) * 0.5 },
                { device: 'thermostat', roomIdx: buf[5] & 0x0F, propertyName: 'current', propertyValue: (buf[8] << 8) + buf[9] / 10.0 },
            ];
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
            return [
                { device: 'ventil', roomIdx: 1, propertyName: 'power', propertyValue: (buf[5] ? 'on' : 'off') },
                { device: 'ventil', roomIdx: 1, propertyName: 'preset', propertyValue: '0' + buf[6] },
            ];
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
            var propArr = [];
            var idx = 13; // 13번째 바이트부터 소비량이 들어있음
            for (let name of ['electric', 'heat', 'hotwater', 'gas', 'water']) {
                consumption = buf.slice(idx, idx + 2).toString('hex');
                propArr.push({ device: 'energy', roomIdx: name, propertyName: 'current', propertyValue: consumption });
                idx += 8;
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
        this._socketWriteEnergy = this.createSocketConnection(CONFIG.energy_port, 'energy');
        this._socketWriteControl = this.createSocketConnection(CONFIG.control_port, 'control');
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
            setTimeout(() => { this._deviceReady = true }, 2000);
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
            warn("MQTT connection lost. try to reconnect...");
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
            if (topics[0] === CONFIG.mqtt.topic_prefix) {
                // mqtt 토픽 변환
                this.SetDeviceProperty(topics[1], topics[2], topics[3], value);
            }
        } else {
            warn('MQTT is not ready. wait...');
        }
    }

    UpdateMqttDeviceStatus(device, roomIdx, propertyName, propertyValue) {
        const prefix = CONFIG.mqtt.topic_prefix;
        const topic = util.format(prefix + '/%s/%s/%s/state', device, roomIdx, propertyName);
        // 현재전력/온도는 로깅 제외
        if (propertyName != 'current') {
            log('publish mqtt:', topic, '=', propertyValue);
        }
        this._mqttClient.publish(topic, String(propertyValue));
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

    createSocketConnection(options, name) {
        if (options.type === 'serial') {
            var connection = new SerialPort({
                path: options.ser_path,
                baudRate: 9600,
                dataBits: 8,
                parity: 'none',
                stopBits: 1,
                autoOpen: false,
                encoding: 'hex'
            });

            connection.pipe(new CustomParser()).on('data', this.PacketHandle.bind(this));
            connection.on('open', () => {
                log(`successfully opened ${name} port: ${options.ser_path}`);
            });
            connection.on('close', () => {
                warn(`closed ${name} port: ${options.ser_path}`);
            });
            connection.open((err) => {
                if (err) {
                    error(`failed to open ${name} port: ${err.message}`);
                }
            });
        }
        else {
            var connection = new net.Socket();

            connection.connect(options.port, options.address, () => {
                log(`successfully connected to ${name}`);
            });
            connection.on('error', (err) => {
                error(`connection error ${err.code}::${name.toUpperCase()}. try to reconnect...`);
                connection.connect(options.port, options.addr);
                // 연결 애러 발생시 reconnect
            });
            connection.pipe(new CustomParser()).on('data', this.PacketHandle.bind(this));
        }
        return connection;
    }

    PacketHandle(packet) {
        var isNew = false;
        this._lastReceive = new Date();  

        if (packet[0] == 0x02 && packet[1] == 0x42) {
            // energy 포트에서 싱크메시지 추청
            this._syncTime = this._lastReceive;
            this._timestamp = packet[4]; // spin_code(0x00-0xff)
        }

        let receivedMsg = this._receivedMsgs.find(e => e.codeHex === packet);
        if (!receivedMsg) {
            isNew = true;
            let cmdHex = [packet[2], packet[3]];
            var foundMsgInfo = MSG_INFO.find(e => e.header === packet[1] && cmdHex.includes(e.cmd));

            receivedMsg = {
                code: packet.toString('hex'),
                codeHex: packet,
                count: 0,
                info: foundMsgInfo,
            };

            receivedMsg.checksum = this.VerifyCheckSum(packet);
            this._receivedMsgs.push(receivedMsg);
        }
        receivedMsg.count++;
        receivedMsg.lastlastReceive = receivedMsg.lastReceive;
        receivedMsg.lastReceive = this._lastReceive;
        receivedMsg.timeslot = this._lastReceive - this._syncTime;

        if (!receivedMsg.checksum) {
            error(`checksum error. ${receivedMsg.code} ${'0x' + receivedMsg.checksum.toString(16)}`);
            return;
        }
        if (!receivedMsg.info) return;

        // 제어 요청에 대한 ack를 받았으면, 해당 명령의 callback 호출 후 명령큐에서 삭제
        let ackHex = [0x81, 0x82, 0x83, 0x92, 0xA2]
        let foundIdx = this._serialCmdQueue.findIndex(e => (e.cmdHex[1] == packet[1]) && (ackHex.includes(foundMsgInfo.cmd)));
        if (foundIdx > -1) {
            log(`Success command: ${this._serialCmdQueue[foundIdx].device}`);
            // 해당 명령에 callback이 정의되어 있으면 호출
            if (this._serialCmdQueue[foundIdx].callback) {
                this._serialCmdQueue[foundIdx].callback(receivedMsg);
            }

            this._serialCmdQueue.splice(foundIdx, 1);
            var force = true;
        }

        // 메세지를 parsing 하여 property로 변환
        if (receivedMsg.info.parseToProperty) {
            var propArray = receivedMsg.info.parseToProperty(packet);
            for (var prop of propArray) {
                this.UpdateDeviceProperty(receivedMsg.info.device, prop.roomIdx, prop.propertyName, prop.propertyValue, force);
            }
        }

        if (CONFIG.packet_log_enabled) {
            let packetHex = packet.toString('hex').toUpperCase();
            let result = "";
            for (let i = 0; i < packetHex.length; i += 2) {
                result += packetHex.substr(i, 2) + " ";
            }        
            let logTime = CONFIG.packet_log_time * 1000;
            let timer = setTimeout(() => {
                fs.appendFileSync(CONFIG.file_name.packet_log, result + '\n', 'utf8');
                clearTimeout(timer);
            }, logTime);
        }
    }

    AddDeviceCommandToQueue(cmdHex, device, roomIdx, propertyName, propertyValue, callback) {
        let now = new Date();
        var serialCmd = {
            cmdHex: cmdHex,
            device: device,
            roomIdx: roomIdx,
            property: propertyName,
            value: propertyValue,
            callback: callback,
            sentTime: now,
            retryCount: CONFIG.retry_count
        };

        // 실행 큐에 저장
        log(`send to device: ${serialCmd.cmdHex.toString('hex')}`);
        this._serialCmdQueue.push(serialCmd);

        let elapsed = now - this._syncTime;
        let delay = (elapsed < 100) ? 100 - elapsed : 0;

        setTimeout(this.ProcessSerialCommand.bind(this), delay);
    }

    ProcessSerialCommand() {
        if (this._serialCmdQueue.length == 0) return;
        var serialCmd = this._serialCmdQueue.shift();
        serialCmd.sentTime = new Date();

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
            setTimeout(this.ProcessSerialCommand.bind(this), CONFIG.retry_delay);

        } else {
            error(`maximum retrying ${CONFIG.retry_count} times of command send exceeded`);
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

        this.AddDeviceCommandToQueue(cmdHex, device, roomIdx, propertyName, propertyValue, callback);

        this.UpdateDeviceProperty(device, roomIdx, propertyName, propertyValue);
        // 처리시간의 Delay때문에 미리 상태 반영
    }

    UpdateDeviceProperty(device, roomIdx, propertyName, propertyValue, force) {
        // 이전과 상태가 같으면 반영 중지
        let curPropertyValue = this._deviceStatusCache[device + roomIdx + propertyName];
        if (!force && curPropertyValue && (propertyValue === curPropertyValue)) return;

        this._deviceStatusCache[device + roomIdx + propertyName] = propertyValue;
        // 이전에 없던 device이면 새로 생성한다.
        let deviceStatus = this._deviceStatus.find(o => (o.device === device) && (o.roomIdx === roomIdx));
        if (!deviceStatus) {
            deviceStatus = this.AddDevice(device, roomIdx);
        }
        // 상태 반영
        deviceStatus.property[propertyName] = propertyValue;

        // mqtt publish
        this.UpdateMqttDeviceStatus(device, roomIdx, propertyName, propertyValue);
    }

    IparkLoginRequest() {
        const that = this;
        request.get(`http://${CONFIG.ipark_server.address}/webapp/data/getLoginWebApp.php?devce=WA&login_ide=${CONFIG.ipark_server.username}&login_pwd=${CONFIG.ipark_server.password}`,
            (error, response) => {
                if (response.statusCode === 200) {
                    log('I-PARK server login successful');
                    that.CookieInfo(response);
                } else {
                    error(`I-PARK server login falied with error code: ${error}`);
                    return;
                }
            });
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

        if (!fs.existsSync(CONFIG.file_name.server_cookie)) {
            fs.writeFileSync(CONFIG.file_name.server_cookie, JSON.stringify(cookieJson), 'utf8');
            log(CONFIG.file_name.server_cookie + 'file saved successfully');
        } else {
            return;
        }
    }

    ParseXML(xml, callback) {
        xml2js.parseString(xml, callback);
    }


}

_HomeRS485 = new HomeRS485();