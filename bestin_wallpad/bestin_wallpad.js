/*
 * @description bestin_wallpad.js
 * @author harwin1
 */

const logger = require('./logger.js');
const Options = require('/data/options.json');

const { SerialPort } = require('serialport');
const { Transform } = require('stream');

const request = require('request');
const xml2js = require('xml2js');
const https = require('https');
const mqtt = require('mqtt');
const net = require('net');
const fs = require('fs');

const {
    V1LOGIN,
    V2LOGIN,
    V1LIGHTSTATUS,
    V2LIGHTSTATUS,
    V2EVSTATUS,
    V1LIGHTCMD,
    V2LIGHTCMD,
    V2ELEVATORCMD,
    EVSTATE,
    VENTTEMP,
    VENTTEMPI,
    ONOFFDEV,
    DISCOVERY_DEVICE,
    DISCOVERY_PAYLOAD
} = require('./const.js');

const MSG_INFO = [
    ///////////////////////
    // 명령

    // 조명
    {
        device: 'light', header: 0x02310D01, length: 13, request: 'set',
        setPropertyToMsg: (b, i, n, v) => {
            let id = n.slice(-1) - 1, pos = (v === 'on' ? 0x80 : 0x00), onff = (v === 'on' ? 0x04 : 0x00);

            b[5] = i & 0x0f;
            if (n === 'all') b[6] = (v === 'on' ? 0x8f : 0x0f);
            else b[6] = (0x01 << id | pos);
            b[11] = onff;

            return b;
        }
    },

    // 콘센트
    {
        device: 'outlet', header: 0x02310D01, length: 13, request: 'set',
        setPropertyToMsg: (b, i, n, v) => {
            let id = n.slice(-1) - 1, pos = (v === 'on' ? 0x80 : 0x00), onff = (v === 'on' ? 0x09 << id : 0x00);

            b[5] = i & 0x0F;
            if (n === 'standby') b[8] = (v === 'on' ? 0x83 : 0x03);
            else if (n === 'all') b[7] = (v === 'on' ? 0x8f : 0x0f), b[11] = onff;
            else b[7] = (0x01 << id | pos), b[11] = onff;

            return b;
        }
    },

    // 난방
    {
        device: 'thermostat', header: 0x02280E12, length: 14, request: 'set',
        setPropertyToMsg: (b, i, n, v) => {
            let val = parseFloat(v), vInt = parseInt(val), vFloat = val - vInt;

            b[5] = i & 0x0f;
            if (n === 'power') b[6] = (v === 'heat' ? 0x01 : 0x02);
            else b[7] = ((vInt & 0xff) | ((vFloat != 0) ? 0x40 : 0x00));

            return b;
        }
    },

    // 환기
    {
        device: 'fan', header: 0x026100, length: 10, request: 'set',
        setPropertyToMsg: (b, i, n, v) => {
            if (n === 'power') b[2] = 0x01, b[5] = (v === 'on' ? 0x01 : 0x00), b[6] = 0x01;
            else b[2] = (v === 'nature' ? 0x07 : 0x03), b[6] = VENTTEMP[v];

            return b;
        }
    },

    /////////////////////
    // 상태

    // 조명
    {
        device: 'light', header: 0x02311E91, length: 30, request: 'ack',
        parseToProperty: (b) => {

            let props = [];
            for (let i = 0; i < ((b[5] & 0x0f) === 1 ? 4 : 2); i++) {
                props.push({ device: 'light', room: b[5] & 0x0f, name: `power${i + 1}`, value: (b[6] & (1 << i)) ? 'on' : 'off' })
            }
            props.push({ device: 'light', room: b[5] & 0x0f, name: 'all', value: (b[6] & 0x0F) ? 'on' : 'off' });

            return props;
        }
    },

    // 콘센트
    {
        device: 'outlet', header: 0x02311E91, length: 30, request: 'ack',
        parseToProperty: (b) => {

            let props = [];
            for (let i = 0; i < ((b[5] & 0x0f) === 1 ? 3 : 2); i++) {
                let i1 = 14 + 2 * i, cons = (b[i1] << 4 | b[i1 + 1]) / 10 || 0;

                props.push({ device: 'outlet', room: b[5] & 0x0f, name: `power${i + 1}`, value: (b[7] & (1 << i)) ? 'on' : 'off' },
                    { device: 'outlet', room: b[5] & 0x0f, name: `usage${i + 1}`, value: cons })
            }
            props.push({ device: 'outlet', room: b[5] & 0x0f, name: 'all', value: (b[7] & 0x0F) ? 'on' : 'off' },
                { device: 'outlet', room: b[5] & 0x0f, name: 'standby', value: (b[7] >> 4 & 1) ? 'on' : 'off' });

            return props;
        }
    },

    // 난방
    {
        device: 'thermostat', header: 0x02281091, length: 16, request: 'ack',
        parseToProperty: (b) => {
            let props = [];
            props.push({ device: 'thermostat', room: b[5] & 0x0f, name: 'power', value: (b[6] & 0x01) ? 'heat' : 'off' },
                { device: 'thermostat', room: b[5] & 0x0f, name: 'target', value: (b[7] & 0x3f) + ((b[7] & 0x40) && 0.5) },
                { device: 'thermostat', room: b[5] & 0x0f, name: 'current', value: ((b[8] << 8) + b[9]) / 10.0 });
            return props;
        }
    },

    // 환기
    {
        device: 'fan', header: 0x026180, length: 10, request: 'ack',
        parseToProperty: (b) => {
            let props = [], val;
            if (VENTTEMPI.hasOwnProperty(b[6])) val = VENTTEMPI[b[6]];
            props.push({ device: 'fan', room: '1', name: 'power', value: (b[5] ? 'on' : 'off') },
                { device: 'fan', room: '1', name: 'preset', value: b[5] === 0x11 ? 'nature' : val });
            return props;
        }
    },

    // 가스
    {
        device: 'gas', header: 0x023180, length: 10, request: 'ack',
        parseToProperty: (b) => {
            let props = [];
            props.push({ device: 'gas', room: '1', name: 'cutoff', value: (b[5] ? 'on' : 'off') },
                { device: 'gas', room: '1', name: 'power', value: (b[5] ? '열림' : '닫힘') });
            return props;
        }
    },

    // 도어락
    {
        device: 'doorlock', header: 0x024180, length: 10, request: 'ack',
        parseToProperty: (b) => {
            let props = [];
            props.push({ device: 'doorlock', room: '1', name: 'power', value: (b[5] === 0x51 ? 'off' : 'on') });
            return props;
        }
    },

    // 에너지
    {
        device: 'energy', header: 0x02D13082, length: 48, request: 'ack',
        parseToProperty: (b) => {
            let props = [], index = 13;
            const index_t = { 'elec': [8, 12], 'water': [17, 19], 'gas': [32, 35] },
                elements = ['elec', 'heat', 'hwater', 'gas', 'water'];

            for (const element of elements) {
                let total_u = b.slice(index_t[element]?.[0], index_t[element]?.[1]).toString('hex');
                let realt_u = b.slice(index, index + 2).toString('hex');
                index += 8;

                total_u = { 'elec': (total_u / 100).toFixed(1), 'water': total_u / 10, 'gas': total_u / 10 }[element];

                if (total_u !== undefined) props.push({ device: 'energy', room: element, name: 'total', value: Number(total_u) });
                props.push({ device: 'energy', room: element, name: 'realt', value: Number(realt_u) });
            }
            return props;
        }
    },
];

class CustomParser extends Transform {
    constructor(options) {
        super(options);
        this.reset();
    }

    reset() {
        this.bufferQueue = [];
        this.lengthCount = 0;
        this.expectedLength = undefined;
        this.isExpectedLength = false;
        this.headerSequence = new Uint8Array([0x17, 0x28, 0x31, 0x41, 0x42, 0x61, 0xD1]);
    }

    _transform(chunk, encoding, done) {
        let remainingChunk = chunk;
        let start = 0;
        let prefixIndex = remainingChunk.indexOf(0x02);

        while (prefixIndex >= 0) {
            let headerIndex = this.headerSequence.indexOf(remainingChunk[prefixIndex + 1]);

            if (headerIndex >= 0) {
                if (this.bufferQueue.length > 0) {
                    this.push(Buffer.concat(this.bufferQueue));
                    this.bufferQueue = [];
                }

                start = prefixIndex;
                this.isExpectedLength = true;
                let expectedLength = this.getExpectedLength(remainingChunk, prefixIndex);

                if (expectedLength > 0) {
                    this.expectedLength = expectedLength;
                    this.isExpectedLength = false;
                } else {
                    this.reset();
                    return done();
                }

                if (this.lengthCount + remainingChunk.length - (prefixIndex + this.expectedLength) >= 0) {
                    let end = prefixIndex + this.expectedLength;
                    this.bufferQueue.push(remainingChunk.slice(start, end));
                    this.push(Buffer.concat(this.bufferQueue));
                    this.bufferQueue = [];

                    remainingChunk = remainingChunk.slice(end);
                    prefixIndex = remainingChunk.indexOf(0x02);
                    start = 0;
                    this.lengthCount = 0;
                } else {
                    this.bufferQueue.push(remainingChunk.slice(start));
                    this.lengthCount += remainingChunk.length - prefixIndex;
                    remainingChunk = Buffer.alloc(0);
                }
            }

            prefixIndex = remainingChunk.indexOf(0x02, prefixIndex + 1);
        }

        this.bufferQueue.push(remainingChunk.slice(start));

        if (this.bufferQueue.length > 1) {
            this.push(Buffer.concat(this.bufferQueue.slice(0, -1)));
            this.bufferQueue = [this.bufferQueue[this.bufferQueue.length - 1]];
        }

        done();
    }

    _flush(done) {
        if (this.bufferQueue.length > 0) {
            this.push(Buffer.concat(this.bufferQueue));
            this.bufferQueue = [];
        }
        this.reset();
        done();
    }

    getExpectedLength(chunk, i) {
        let expectedLength = 0;
        if ([0x31, 0x41].includes(chunk[i + 1]) && [0x00, 0x02, 0x80, 0x82].includes(chunk[i + 2])) {
            // 가스, 환기, 도어락 패킷 길이 10고정
            expectedLength = 10;
        } else if (chunk[i + 1] === 0x61) {
            // 나머지 3바이트의 10 진수 길이를 따라감
            expectedLength = 10;
        }

        return expectedLength === 10 ? 10 : chunk[i + 2];
    }
}


class rs485 {
    constructor() {
        this._receivedMsgs = [];
        this._mqttConnected = false;
        this._syncTime = new Date();
        this._lastReceive = new Date();
        this._commandQueue = new Array();
        this._serialCmdQueue = new Array();
        this._deviceStatusCache = {};
        this._deviceStatus = [];
        this._connection = null;

        this._mqttClient = this.mqttClient();
        this._connEnergy = this.createConnection(Options.energy, 'energy');
        this._connControl = this.createConnection(Options.control, 'control');
        this.serverCreate(Options.server_enable, Options.server_type);
    }

    mqttClient() {
        const client = mqtt.connect({
            host: Options.mqtt.broker,
            port: Options.mqtt.port,
            username: Options.mqtt.username,
            password: Options.mqtt.password,
            keepalive: 60,  // 세션 유지
            reconnect: true,  // 재접속 허용
            reconnectInterval: 1000  // 재접속 간격
        });

        client.on('connect', () => {
            logger.info('MQTT connection successful!');
            this._mqttConnected = true;
            const topics = ['bestin/+/+/+/command', 'homeassistant/status'];
            topics.forEach(topic => {
                client.subscribe(topic, (err) => {
                    logger.info(`subscribe  ${topic}`)
                    if (err) {
                        logger.error(`failed to subscribe to ${topic}`);
                    }
                });
            });
        });

        client.on('error', (err) => {
            logger.error(`MQTT connection error: ${err}`);
            this._mqttConnected = false;
        });

        client.on('reconnect', () => {
            logger.warn('MQTT connection lost. try to reconnect...');
        });
        logger.info('initializing mqtt...');

        client.on('message', this.mqttCommand.bind(this));
        return client;
    }

    mqttCommand(topic, message) {
        if (!this._mqttConnected) {
            logger.warn('MQTT is not ready yet');
            return;
        }
        let topics = topic.split("/");
        let value = message.toString();
        let json;
        if (topics[0] !== Options.mqtt.prefix) {
            return;
        }

        if (Options.server_enable) {
            json = JSON.parse(fs.readFileSync('./session.json'));
        }

        logger.info(`recv. message: ${topic} = ${value}`);

        if (topics[2] === '0' || topics[1] === 'elevator') {
            this.serverCommand(topics, value, json);
        } else {
            const [device, room, name] = topics.slice(1, 4);
            this.setCommandProperty(device, room, name, value);
        }
    }

    mqttClientUpdate(device, room, name, value) {
        if (!this._mqttConnected) {
            return;
        }
        const prefix = Options.mqtt.prefix;
        const topic = `${prefix}/${device}/${room}/${name}/state`;

        if (typeof value !== 'number') {
            // 사용량이 계속 바뀌는 경우 로깅 제외(에너지, 난방 현재온도, 콘센트 사용량 등)
            logger.info(`publish to mqtt: ${topic} = ${value}`);
        }
        this._mqttClient.publish(topic, String(value), { retain: true });
    }

    formatDiscovery(prefix, device, room, name) {
        let payloads = this.JSON(DISCOVERY_PAYLOAD[device]);

        for (let i = 0; i < payloads.length; i++) {
            if (/\d+$/.test(name)) {
                // name 변수의 숫자(index)가 포함된 경우
                if (device === 'light') {
                    this.format(payloads[i], prefix, room, name);
                    payloads[i]['name'] = payloads[i]['name'].replace(/power|switch/g, "");
                } else {
                    this.format(payloads[i], prefix, room, name.slice(-1));
                }
            } else {
                if (payloads[i]['_intg'] !== 'sensor' || ['energy', 'gas', 'elevator'].includes(device)) {
                    this.format(payloads[i], prefix, room, name);
                    if (device === 'energy') {
                        payloads[i]['unit_of_meas'] = { 'elec': 'kWh', 'heat': 'MWh' }[room] ?? 'm³';
                    }
                }
            }
            this.mqttDiscovery(payloads[i]);
        }
    }

    mqttDiscovery(payload) {
        let integration = payload['_intg'];
        let payloadName = payload['name'];

        payload['uniq_id'] = payloadName;
        payload['device'] = DISCOVERY_DEVICE;

        //console.log(payload);
        const topic = `homeassistant/${integration}/bestin_wallpad/${payloadName}/config`;
        this._mqttClient.publish(topic, JSON.stringify(payload), { retain: true });
    }

    // 패킷 체크섬 검증
    verifyCheckSum(packet) {
        let sum = 3;
        for (let i = 0; i < packet.length - 1; i++) {
            sum ^= packet[i];
            sum = (sum + 1) & 0xff;
        }
        return sum === packet[packet.length - 1];
        // 패킷 체크섬 인덱스랑 생성된 체크섬 검증
    }

    // 명령 패킷 마지막 바이트(crc) 생성
    generateCheckSum(packet) {
        let sum = 3;
        for (let i = 0; i < packet.length - 1; i++) {
            sum ^= packet[i];
            sum = (sum + 1) & 0xff;
        }
        return sum;
    }

    createConnection(options, name) {
        if (options.path === "" && options.address === "") {
            // serial 또는 socket의 path나 address 값이 없다면 해당 포트는 사용하지 않는걸로 간주 비활성화
            logger.warn(`${name} connection disabled!`);
            return;
        }
        logger.info(`initializing ${options.type} :: ${name}...`);
        if (options.type === 'serial') {
            this._connection = new SerialPort({
                path: options.path,
                baudRate: 9600,
                dataBits: 8,
                parity: 'none',
                stopBits: 1,
                autoOpen: false,
                encoding: 'hex'
            });

            this._connection.pipe(new CustomParser()).on('data', this.handlePacket.bind(this));
            this._connection.on('open', () => {
                logger.info(`successfully opened ${name} port: ${options.path}`);
            });
            this._connection.on('close', () => {
                logger.warn(`closed ${name} port: ${options.path}`);
            });
            this._connection.open((err) => {
                if (err) {
                    logger.error(`failed to open ${name} port: ${err.message}`);
                }
            });
        } else if (options.type === 'socket') {
            this._connection = new net.Socket();
            this._connection.connect(options.port, options.address, () => {
                logger.info(`successfully connected to ${name}  [${options.address}:${options.port}]`);
            });
            this._connection.on('error', (err) => {
                if (err.code == 'ETIMEDOUT') {
                    logger.error(`${name} connection error occurred process.exit`);
                    setTimeout(() => process.exit(1), 0);
                } else {
                    logger.error(`connection error ${err.code}::${name.toUpperCase()}. try to reconnect...`);
                    this._connection.connect(options.port, options.address);
                }
            });
            this._connection.pipe(new CustomParser()).on('data', this.handlePacket.bind(this));
        }
        return this._connection;
    }

    handlePacket(packet) {
        if (packet[1] === 0xd1 && packet[3] === 0x82) {
            //console.log(packet);
        }
        this._lastReceive = new Date();

        if (packet[0] === 0x02) {
            this._syncTime = this._lastReceive;
            this._timestamp = packet[4];
        }

        const receivedMsg = this.findOrCreateReceivedMsg(packet);
        receivedMsg.count++;
        receivedMsg.lastlastReceive = receivedMsg.lastReceive;
        receivedMsg.lastReceive = this._lastReceive;
        receivedMsg.timeslot = this._lastReceive - this._syncTime;

        //console.log(receivedMsg.isValid)
        if (!receivedMsg.isValid) {
            logger.error(`checksum error: ${receivedMsg.code}, ${receivedMsg.isValid}`);
            return;
        }

        const foundIdx = this.findCommandIndex(packet, receivedMsg);
        //console.log(foundIdx)
        if (foundIdx > -1) {
            logger.info(`success command: ${this._serialCmdQueue[foundIdx].device}, command idx: ${foundIdx}`);
            const { callback, device } = this._serialCmdQueue[foundIdx];
            if (callback) callback(receivedMsg);
            this._serialCmdQueue.splice(foundIdx, 1);
        }

        for (const msgInfo of receivedMsg.validMsgInfos) {
            this.updateProperties(msgInfo, packet, foundIdx > -1);
        }
    }

    findOrCreateReceivedMsg(packet) {
        const { _receivedMsgs } = this;
        const codeHex = Buffer.from(packet);

        const found = _receivedMsgs.find(({ codeHex: existingCodeHex }) => existingCodeHex.equals(codeHex));
        if (found) return found;

        const code = codeHex.toString('hex');
        const expectLength = packet[2] === packet.length ? 4 : 3;
        const actualLength = packet.length;
        const actualHeader = parseInt(packet.subarray(0, expectLength).toString('hex'), 16);

        const validMsgInfos = MSG_INFO.filter(({ header, length }) => {
            if (header === actualHeader && length === actualLength) return actualHeader;
        });

        const isValid = this.verifyCheckSum(packet);
        const receivedMsg = {
            code,
            codeHex,
            count: 0,
            validMsgInfos,
            //isValid,
        };
        receivedMsg.isValid = receivedMsg.validMsgInfos[0] ? isValid : true;
        // receivedMsg.validMsgInfos[0] 값이 있는 경우 isValid 변환 아닌경우 항상 true 변환(해당 property 없음)
        _receivedMsgs.push(receivedMsg);
        return receivedMsg;
    }

    findCommandIndex(packet, msg) {
        return this._serialCmdQueue.findIndex(({ cmdHex }) => {
            const i = cmdHex.length === 10 ? 2 : 3;
            const ackHex = ((cmdHex[1] === 0x28 ? 0x9 : 0x8) << 4) | cmdHex[i] & 0x0f;
            return (cmdHex[1] === packet[1] && Number("0x" + ackHex.toString(16)) === packet[i]);
        });
    }

    updateProperties(msgInfo, packet, isCommandResponse) {
        if (!msgInfo.parseToProperty) return;

        const propArray = msgInfo.parseToProperty(packet);
        for (const { device, room, name, value } of propArray) {
            this.updateProperty(device, room, name, value, isCommandResponse);
        }
    }

    addCommandToQueue(cmdHex, device, room, name, value, callback) {
        const serialCmd = {
            cmdHex,
            device,
            room,
            property: name,
            value: value,
            callback,
            sentTime: new Date(),
            retryCount: Options.rs485.max_retry
        };

        this._serialCmdQueue.push(serialCmd);
        logger.info(`send to device: ${cmdHex.toString('hex')}`);

        const elapsed = serialCmd.sentTime - this._syncTime;
        const delay = (elapsed < 100) ? 100 - elapsed : 0;
        // 100ms 이후 실행 하도록 함

        setTimeout(() => this.processCommand(serialCmd), delay);
    }

    processCommand(serialCmd) {
        if (this._serialCmdQueue.length === 0) {
            return;
        }
        serialCmd = this._serialCmdQueue.shift();

        const writeHandle = {
            'light': this._connEnergy,
            'outlet': this._connEnergy,
            'fan': this._connControl,
            'gas': this._connControl,
            'thermostat': this._connControl,
            'doorlock': this._connControl,
        }[serialCmd.device];
        // 디바이스별 포트 설정

        if (!writeHandle) {
            logger.error(`invalid device: ${serialCmd.device}`);
            return;
        }

        writeHandle.write(serialCmd.cmdHex, (err) => {
            if (err) {
                logger.error('send error:', err.message);
            }
        });

        if (serialCmd.retryCount > 0) {
            serialCmd.retryCount--;
            this._serialCmdQueue.push(serialCmd);
            setTimeout(() => this.processCommand(serialCmd), 100);
        } else {
            logger.warn(`command(${serialCmd.device}) has exceeded the maximum retry limit of ${Options.rs485.max_retry} times`);
            if (serialCmd.callback) {
                serialCmd.callback.call(this);
            }
        }
    }

    putStatusProperty(device, room, property) {
        var deviceStatus = {
            device: device,
            room: room,
            property: (property ? property : {})
        };
        this._deviceStatus.push(deviceStatus);
        return deviceStatus;
    }

    OnOffDevice(device, value) {
        const devices = {
            'gas': [0x02, 0x31, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x3D],
            'doorlock': [0x02, 0x41, 0x02, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x4E],
            'lightcutoff': [0x02, 0x31, 0x0B, 0x02, 0x31, 0x3f, 0x00, 0x00, 0x00, 0x00, 0x51],
        };

        const deviceData = devices[device];
        if (!deviceData) return null;

        if (Array.isArray(deviceData)) {
            return Buffer.from(deviceData);
        }

        if (value !== 'on' && value !== 'off') return null;
        return Buffer.from(deviceData[value]);
    }

    setCommandProperty(device, room, name, value, callback) {
        const ownProp = room === 'all' ? device + name : device;
        const msgInfo = MSG_INFO.find(e => e.setPropertyToMsg && (ownProp === e.device || ONOFFDEV.hasOwnProperty(ownProp)));

        if (!msgInfo) {
            logger.warn(`   unknown device: ${device}`);
            return;
        }
        if (ONOFFDEV.hasOwnProperty(ownProp) && value !== ONOFFDEV[ownProp]) {
            logger.warn(`   unknown command: ${device}, ${value}`)
            return;
        }
        if (value == "") {
            logger.warn(`   no payload: ${device}`)
            return;
        }

        const cmdLength = msgInfo.length === 10 ? 3 : 4;
        const cmdHex = Buffer.alloc(msgInfo.length);
        cmdHex.writeUIntBE(msgInfo.header, 0, cmdLength);
        msgInfo.setPropertyToMsg(cmdHex, room, name, value);
        cmdHex[msgInfo.length - 1] = this.generateCheckSum(cmdHex);

        const buffer = ONOFFDEV.hasOwnProperty(ownProp) ? this.OnOffDevice(ownProp, value) : cmdHex;
        this.addCommandToQueue(buffer, device, room, name, value, callback);
    }

    updateProperty(device, room, name, value, force) {
        const propertyKey = device + room + name;
        const isSamePropertyValue = !force && this._deviceStatusCache[propertyKey] === value;
        if (isSamePropertyValue) return;

        this._deviceStatusCache[propertyKey] = value;

        let deviceStatus = this._deviceStatus.find(o => o.device === device && o.room === room);
        if (!deviceStatus) {
            deviceStatus = this.putStatusProperty(device, room);
        }
        deviceStatus.property[name] = value;

        this.mqttClientUpdate(device, room, name, value);

        const discoveryOn = setImmediate(() => {
            if (!this._discovery && Options.mqtt.discovery) {
                this.formatDiscovery(Options.mqtt.prefix, device, room, name);
            } else {
                return true;
            }
        });

        setTimeout(() => {
            clearImmediate(discoveryOn);
            this._discovery = true;
        }, 20000);
    }

    serverCreate(enable, type) {
        if (!enable) {
            return false;
        }

        const loginFunc = type === 'v1' ? this.serverLogin.bind(this) : this.serverLogin2.bind(this);
        loginFunc('fresh');
        setInterval(loginFunc, type === 'v1' ? 1200000 : 3600000, 'refresh');
    }

    serverLogin(time) {
        request.get(V1LOGIN, (error, response, body) => {
            if (error) {
                logger.error(`IPARK v1 server ${time === 'fresh' ? 'login' : 'session refresh'} failed with error code: ${error}`);
                return;
            }

            if (time === 'refresh') {
                logger.info('IPARK v1 server session refreshing...');
            }

            const parse = JSON.parse(body);
            if (response.statusCode === 200 && parse.ret === 'success') {
                if (time === 'fresh') {
                    logger.info(`IPARK v1 server login successful! \n=== ${parse}`);
                    this.loginManagement(response, 'v1', 'fresh');
                } else {
                    logger.info('IPARK v1 server session refresh successful!');
                    this.loginManagement(response, 'v1', 'refresh');
                }
            } else {
                logger.warn(`IPARK v1 server login failed: ${parse.ret}`);
            }
        });
    }

    serverLogin2(time) {
        request.post(V2LOGIN, (error, response, body) => {
            if (error) {
                logger.error(`IPARK v2 server ${time === 'fresh' ? 'login' : 'session refresh'} failed with error code: ${error}`);
                return;
            }

            if (time === 'refresh') {
                logger.info('IPARK v2 server session refreshing...');
            }

            const parse = JSON.parse(body);
            if (response.statusCode === 200) {
                if (time === 'fresh') {
                    logger.info(`IPARK v2 server login successful! \n=== ${JSON.stringify({ ...parse, 'access-token': "*".repeat(parse['access-token'].length) })}`);
                    this.loginManagement(parse, 'v2', 'fresh');
                } else {
                    logger.info('IPARK v2 server session refresh successful!');
                    this.loginManagement(parse, 'v2', 'refresh');
                }
            } else {
                logger.error(`IPARK v2 server error statusCode: ${response.statusCode}`);
            }
        });
    }

    format(obj, ...args) {
        Object.keys(obj).forEach(key => {
            const val = obj[key];
            if (typeof val === 'object') {
                this.format(val, ...args);
            } else if (typeof val === 'string') {
                obj[key] = val.replace(/\{(\d+)\}/g, (match, p1) => args[p1]);
            }
        });
        return obj;
    }

    JSON(obj) {
        return JSON.parse(JSON.stringify(obj));
    }


    loginManagement(res, type, time) {

        const isV1 = type === 'v1';
        const cookie = () => {
            const cookies = res.headers['set-cookie'];
            const cookieMap = cookies.reduce((acc, cookie) => {
                const [key, value] = cookie.split('=');
                acc[key] = value.split(';')[0];
                return acc;
            }, {});

            const cookieJson = {
                phpsessid: cookieMap['PHPSESSID'],
                userid: cookieMap['user_id'],
                username: cookieMap['user_name'],
            };

            if (!cookieJson) {
                logger.error('unable to assign parsed login cookie information to cookieInfo from server');
                return;
            }
            return cookieJson;
        }

        if (isV1) var cookieJson = cookie();
        const data = isV1 ? cookieJson : res;

        try {
            fs.writeFileSync('./session.json', JSON.stringify(data));
            if (time === 'fresh') logger.info(`session.json file write successful!`);
        } catch (err) {
            logger.error(`session.json file write fail. [${err}]`);
            return;
        }

        const json = JSON.parse(fs.readFileSync('./session.json'));

        const statusUrl = isV1 ? this.format(V1LIGHTSTATUS, json.phpsessid, json.userid, json.username) : this.format(V2LIGHTSTATUS, json.url, json['access-token']);
        const lightStatFunc = this.getServerLightStatus.bind(this);
        lightStatFunc(statusUrl, type, 'fresh');
        setInterval(lightStatFunc, Options.server.scan_interval * 1000, this.JSON(statusUrl), type, 'refresh');

        if (!isV1) {
            this.format(V2EVSTATUS, json.url.split('://')[1]);
            this.getServerEVStatus(V2EVSTATUS);
        }
    }

    getServerLightStatus(url, type, time) {
        request.get(url, (error, response, body) => {
            if (error) {
                logger.error(`failed to retrieve server light status: ${error}`);
                return;
            }

            if (response.statusCode !== 200) {
                logger.error(`failed to retrieve server light status: status code ${response.statusCode}`);
                return;
            }

            try {
                if (body) logger.info(`server light status ${time === 'fresh' ? 'request' : 'update'} successful!`);
            } catch (error) {
                logger.error(`server light status ${time === 'fresh' ? 'request' : 'update'} fail! [${error}]`);
                return;
            }

            if (type === 'v1') {
                this.parseXmlLightStatus(body);
            } else {
                this.parseJsonLightStatus(body);
            }
        });
    }

    parseXmlLightStatus(xml) {
        xml2js.parseString(xml, (err, result) => {
            if (err) {
                logger.error(`Failed to parse XML light status: ${err}`);
                return;
            }

            const statusInfo = result?.imap?.service?.[0]?.status_info;

            if (!statusInfo) {
                logger.warn('failed to parse XML light status: status_info property not found');
                return;
            }

            statusInfo.forEach(status => {
                const device = 'light';
                const room = '0';

                this.updateProperty(device, room, status.$.unit_num, status.$.unit_status);
            });
        });
    }

    parseJsonLightStatus(json) {
        let jsonData;

        try {
            jsonData = JSON.parse(json);
        } catch (err) {
            logger.error(`Failed to parse JSON light status: ${err}`);
            return;
        }

        const units = jsonData?.units;

        if (!units) {
            logger.warn('Failed to parse JSON light status: "units" property not found');
            return;
        }

        let allOff = true;

        units.forEach((unit) => {
            const device = 'light';
            const room = '0';

            if (unit.state === 'on') {
                allOff = false;
            }
            if (true) {
                const unit = 'all';
                const state = allOff ? 'off' : 'on';

                this.updateProperty(device, room, unit, state);
            }

            this.updateProperty(device, room, unit.unit, unit.state);
        });
    }

    getServerEVStatus(url) {
        const req = https.request(url, res => {

            res.on('data', d => {
                const resStr = d.toString();
                const resLines = resStr.split('\n');

                const evEvent = resLines[1].substring(7);
                const evInfo = JSON.parse(resLines[2].substring(5));

                if (evInfo.address !== Options.server.address) {

                } else {
                    const device = 'elevator';
                    const room = '1';

                    let name, value;
                    if (evEvent) {
                        name = 'direction';
                        value = EVSTATE[evEvent];
                        this.updateProperty(device, room, name, value);
                    }
                    if (evInfo.move_info) {
                        name = 'floor';
                        value = evInfo.move_info.Floor;
                        this.updateProperty(device, room, name, value);
                    }
                    name = 'call';
                    value = evEvent === 'arrived' ? 'off' : 'on';

                    this.updateProperty(device, room, name, value);
                }
            });
        });

        req.on('error', error => {
            logger.error(error);
        });

        req.end();
    }

    serverCommand(topic, value, json) {
        if (topic[1] === 'light') {
            this.serverLightCommand(topic[3], value, Options.server_type, json);
        } else if (topic[1] === 'elevator') {
            const logMessage = 'elevator calls through the server are supported only in v2 version!';
            Options.server_type === 'v2' ? this.serverEvCommand(json) : logger.warn(logMessage);
        }
    }

    serverLightCommand(unit, state, type, json) {
        let url;
        if (type === 'v1') {
            if (unit === 'all') {
                logger.error('v1 server does not support living room lighting batch');
                return;
            }
            url = this.format(this.JSON(V1LIGHTCMD), json.phpsessid, json.userid, json.username, unit, state);
        } else {
            url = this.format(this.JSON(V2LIGHTCMD), json.url, unit.slice(-1), unit, state, json['access-token']);
        }
        request(url, (error, response) => {
            if (error) {
                logger.error(`failed to retrieve server light command: ${error}`);
                return;
            }

            if (response.statusCode !== 200) {
                logger.error(`failed to retrieve server light command: status code ${response.statusCode}`);
                return;
            }
            logger.info('server livinglight command request successful!');

            const device = 'light';
            const room = '0';
            let allOff = true;

            if (state === 'on') {
                allOff = false;
            }
            if (true) {
                const unit = 'all';
                const state = allOff ? 'off' : 'on';

                this.updateProperty(device, room, unit, state);
            }

            this.updateProperty(device, room, unit, state);
        });
    }

    serverEvCommand(json) {
        const url = this.format(V2ELEVATORCMD, json.url);
        request(url, (error, response) => {
            if (error) {
                logger.error(`failed to retrieve server elevator command: ${error}`);
                return;
            }

            if (response.statusCode !== 200) {
                logger.error(`failed to retrieve server elevator command: status code ${response.statusCode}`);
                return;
            }
            logger.info('server elevator command request successful!');
        });
    }

}
new rs485();
