/*
 * @description kocom_wallpad.js
 * @author harwin1
 */

const logger = require('./logger.js');
const { SerialPort } = require('serialport');
const { Transform } = require('stream');

const mqtt = require('mqtt');
const net = require('net');

const Options = require('/data/options.json');

const RS485_DEVICE = [
    ////////////// 상태
    // 조명
    {
        name: 'light', type: 0xdc, dev: 0x0e, cmd: 0x00,
        parseToProperty: (b) => {
            let props = [];
            
            for (let i = 0; i < 3; i++) {
                props.push({ device: 'light', room: b[6], name: 'power'+i, value: b[10+i] === 0xff ? 'on' : 'off' })
            }
            return props;
        }
    },

    // 콘센트 
    {
        name: 'outlet', type: 0xdc, dev: 0x3b, cmd: 0x00,
        parseToProperty: (b) => {
            let props = [];

            for (let i = 0; i < 2; i++) {
                props.push({ device: 'outlet', room: b[6], name: 'power'+i, value: b[10+i] === 0xff ? 'on' : 'off' })
            }
            return props;
        }
    },

    // 난방
    {
        name: 'thermostat', type: 0xdc, dev: 0x36, cmd: 0x00,
        parseToProperty: (b) => {
            let props = [];
            const value8 = { '1100': 'heat', '0100': 'off', '1101': 'fan_only' };

            props.push({ device: 'thermostat', room: b[6], name: 'power', value: value8[b.slice(10, 12).toString('hex')] });
            props.push({ device: 'thermostat', room: b[6], name: 'target', value: b[12] });
            props.push({ device: 'thermostat', room: b[6], name: 'current', value: b[14] });

            return props;
        }
    },

    // 환기
    {
        name: 'fan', type: 0xdc, dev: 0x48, cmd: 0x00,
        parseToProperty: (b) => {
            let props = [];
            const value8 = { '4': 'low', '8': 'medium', 'c': 'high' };

            props.push({ device: 'fan', room: b[6], name: 'power', value: b.slice(10, 12).toString('hex')==='1101' ? 'on' : 'off' });
            if (b[12] !== 0x00) props.push({ device: 'fan', room: b[6], name: 'preset', value: value8[((b[12] >> 4) & 0xf).toString(16)] });

            return props;
        }
    },

    //가스
    {
        name: 'gas', type: 0xdc, dev: 0x2c, cmd: 0x00,
        parseToProperty: (b) => {
            let props = [];

            props.push({ device: 'gas', room: b[6], name: 'cutoff', value: b[10] === 0x00 ? 'on' : 'off' });
            props.push({ device: 'gas', room: b[6], name: 'power', value: b[10] === 0x00 ? '열림' : '닫힘' });

            return props;
        }
    },

    ////////////// 명령
    //조명
    {
        name: 'light', type: 0xbc, dev: 0x0e, cmd: [0x00, 0x3a],
        setPropertyToMsg: (b, rm, nm, val) => {    //rx    tx
            b[6] = rm, b[7] = 0x1; b[10 + Number(nm.slice(-1))] = val === 'on' ? 0xff : 0x00;
            return b;
        }
    },

    //콘센트
    {                                                    
        name: 'outlet', type: 0xbc, dev: 0x3b, cmd: [0x00, 0x3a],
        setPropertyToMsg: (b, rm, nm, val) => {     //rx    tx
            b[6] = rm, b[7] = 0x1; b[10 + Number(nm.slice(-1))] = val === 'on' ? 0xff : 0x00;
            return b;
        }
    },

    //난방
    {
        name: 'thermostat', type: 0xbc, dev: 0x36, cmd: [0x00, 0x3a],
        setPropertyToMsg: (b, rm, nm, val) => {         //rx    tx
            const value8 = { 'off': '0100', 'heat': '1100', 'fan_only': '1101' };

            b[6] = rm, b[7] = 0x1;
            if (nm === 'power') p.writeUint16BE(value8[val], 10, 12); else b[12] = parseInt(v);
            return b;
        }
    },

    //환기
    {
        name: 'fan', type: 0xbc, dev: 0x48, cmd: [0x00, 0x3a],
        setPropertyToMsg: (b, rm, nm, val) => {
            const value8 = { 'low': '4', 'medium': '8', 'high': 'c' };

            b[6] = rm, b[7] = 0x1;
            if (nm === 'power') b.writeUint16BE(val === 'on' ? '1101' : '0001', 10, 12); else b[12] = value8[val];
            return b;
        }
    },
];

const DISCOVERY_DEVICE = {
    'ids': ['kocom_wallpad'],
    'name': 'kocom_wallpad',
    'mf': "KOCOM",
    'mdl': "Kocom Wallpad",
    'sw': "harwin1/ha-addons/kocom_wallpad",
};

const DISCOVERY_PAYLOAD = {
    light: [{
        _intg: 'light',
        name: '{0}_light_{1}_{2}',
        cmd_t: '{0}/light/{1}/{2}/command',
        stat_t: '{0}/light/{1}/{2}/state',
        pl_on: "on",
        pl_off: "off",
    }],
    outlet: [{
        _intg: 'switch',
        name: '{0}_outlet_{1}_{2}',
        cmd_t: '{0}/outlet/{1}/{2}/command',
        stat_t: '{0}/outlet/{1}/{2}/state',
        pl_on: "on",
        pl_off: "off",
        icon: 'mdi:power-socket-eu'
    }],
    gas: [{
        _intg: 'sensor',
        name: '{0}_gas_valve',
        stat_t: '{0}/gas/{1}/power/state',
    },
    {
        _intg: 'switch',
        name: '{0}_gas_cutoff',
        cmd_t: '{0}/gas/{1}/cutoff/command',
        stat_t: '{0}/gas/{1}/cutoff/state',
        pl_on: "on",
        pl_off: "off",
        icon: 'mdi:gas-cylinder'
    }],
    fan: [{
        _intg: 'fan',
        name: '{0}_fan',
        cmd_t: '{0}/fan/{1}/power/command',
        stat_t: '{0}/fan/{1}/power/state',
        pr_mode_cmd_t: '{0}/fan/{1}/preset/command',
        pr_mode_stat_t: '{0}/fan/{1}/preset/state',
        pr_modes: ["low", "medium", "high"],
        pl_on: "on",
        pl_off: "off",
    }],
    thermostat: [{
        _intg: 'climate',
        name: '{0}_thermostat_{1}',
        mode_cmd_t: '{0}/thermostat/{1}/power/command',
        mode_stat_t: '{0}/thermostat/{1}/power/state',
        temp_cmd_t: '{0}/thermostat/{1}/target/command',
        temp_stat_t: '{0}/thermostat/{1}/target/state',
        curr_temp_t: '{0}/thermostat/{1}/current/state',
        modes: ["off", "heat", "fan_only"],
        min_temp: 5,
        max_temp: 40,
        temp_step: 1,
    }]
};

class CustomParser extends Transform {
    constructor(options) {
        super(options);
        this.bufferMaxLength = 21;
        this.buffer = Buffer.alloc(0);
    }

    _transform(chunk, encoding, done) {
        this.buffer = Buffer.concat([this.buffer, chunk]);

        while (this.buffer.length >= this.bufferMaxLength) {
            const startIndex = this.buffer.indexOf(Buffer.from([0xaa, 0x55]));
            if (startIndex !== 0) {
                this.buffer = this.buffer.slice(startIndex);
            }

            if (this.buffer.length < this.bufferMaxLength) {
                break;
            }

            const endIndex = this.buffer.lastIndexOf(Buffer.from([0x0d, 0x0d]), this.bufferMaxLength - 2);
            if (endIndex !== this.bufferMaxLength - 2) {
                this.buffer = this.buffer.slice(startIndex + 2);
                continue;
            }

            const packet = this.buffer.slice(0, this.bufferMaxLength);
            this.push(packet);
            this.buffer = this.buffer.slice(this.bufferMaxLength);
        }

        done();
    }

    _flush(done) {
        if (this.buffer.length > 0) {
            this.push(this.buffer);
        }
        done();
    }
}


class KocomRS485 {
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
        this._connWallpad = this.createConnection();
    }

    mqttClient() {
        const client = mqtt.connect({
            host: Options.mqtt.server,
            port: Options.mqtt.port,
            username: Options.mqtt.username,
            password: Options.mqtt.password,
            keepalive: 60,
            reconnect: true,
            reconnectInterval: 1000
        });

        client.on('connect', () => {
            logger.info('MQTT connection successful!');
            this._mqttConnected = true;
            const topics = [`kocom/+/+/+/command`, 'homeassistant/status'];
            topics.forEach(topic => {
                logger.info(`subscribe  ${topic}`);
                client.subscribe(topic, (err) => {
                    if (err) {
                        logger.warn(`failed to subscribe to ${topic}`);
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
        logger.info('initialize mqtt...');

        client.on('message', this.mqttCommand.bind(this));
        return client;
    }

    mqttCommand(topic, message) {
        if (!this._mqttConnected) {
            logger.warn('MQTT is not ready yet');
            return;
        }
        const topics = topic.split("/");
        const value = message.toString();
        if (topics[0] !== Options.mqtt.prefix) {
            return;
        }
        logger.info(`recv. message: ${topic} = ${value}`);

        const [device, room, name] = topics.slice(1, 4);
        this.setCommandProperty(device, room, name, value);
    }

    mqttClientUpdate(device, room, name, value) {
        if (!this._mqttConnected) {
            return;
        }
        const topic = `${Options.mqtt.prefix}/${device}/${room}/${name}/state`;

        if (name !== 'current') {
            logger.info(`publish to mqtt: ${topic} = ${value}`);
        }
        this._mqttClient.publish(topic, String(value), { retain: true });
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

    mqttDiscovery(pref, dev, rm, nm) {
        let payloads = DISCOVERY_PAYLOAD[dev];

        for (let i = 0; i < payloads.length; i++) {
            let payload = JSON.parse(JSON.stringify(payloads[i]));

            this.format(payload, pref, rm, nm);
            payload['name'] = payload['name'].replace('power', '');

            payload['uniq_id'] = payload['name'];
            payload['device'] = DISCOVERY_DEVICE;

            const topic = `homeassistant/${payload['_intg']}/kocom_wallpad/${payload['name']}/config`;
            this._mqttClient.publish(topic, JSON.stringify(payload), { retain: true });
        }
    }

    // 패킷 체크섬 검증
    checksum(packet) {
        if (packet.length < 18) {
            return false;
        }
        let p_sum = 0;
        for (let i = 0; i < 18; i++) {
            p_sum += parseInt(packet[i], 10);
        }
        const c_sum = ((p_sum + 1) % 256).toString(16).padStart(2, '0');
        return packet[18].toString(16) === c_sum;
    }

    makesum(packet) {
        if (packet.length < 18) {
            return false;
        }
        let p_sum = 0;
        for (let i = 0; i < 18; i++) {
            p_sum += parseInt(packet[i], 10);
        }
        const c_sum = ((p_sum + 1) % 256).toString(16).padStart(2, '0');
        return c_sum;
    }

    createConnection() {
        if (Options.serial_mode === 'serial') {
            logger.info(`initialize serial...`);

            this._connection = new SerialPort({
                path: Options.serial.port,
                baudRate: Options.serial.baudrate,
                dataBits: Options.serial.databits,
                parity: Options.serial.parity,
                stopBits: Options.serial.stopbits,
                autoOpen: false,
                encoding: 'hex'
            });

            this._connection.pipe(new CustomParser()).on('data', this.handlePacket.bind(this));
            this._connection.on('open', () => {
                logger.info(`successfully opened port: ${Options.serial.port}`);
            });
            this._connection.on('close', () => {
                logger.warn(`closed port: ${Options.serial.port}`);
            });
            this._connection.open((err) => {
                if (err) {
                    logger.error(`failed to open port: ${err.message}`);
                }
            });
        } else {
            logger.info(`initialize socket...`);

            this._connection = new net.Socket();
            this._connection.connect(Options.socket.port, Options.socket.address, () => {
                logger.info(`connection successful. [${Options.socket.address}:${Options.socket.port}]`);
            });
            this._connection.on('error', (err) => {
                if (err.code === 'ETIMEDOUT') {
                    logger.error(`connection error occurred process.exit`);
                    setTimeout(() => process.exit(1), 0);
                } else {
                    logger.error(`connection error ${err.code}. try to reconnect...`);
                    this._connection.connect(Options.socket.port, Options.socket.address,);
                }
            });
            this._connection.pipe(new CustomParser()).on('data', this.handlePacket.bind(this));
        }
        return this._connection;
    }

    handlePacket(packet) {
        //console.log(packet.toString('hex'));
        this._lastReceive = new Date();
        if (packet[3] !== 0xdc) {
            this._syncTime = this._lastReceive;
        }

        const receivedMsg = this.findOrCreateReceivedMsg(packet);
        receivedMsg.count++;
        receivedMsg.lastlastReceive = receivedMsg.lastReceive;
        receivedMsg.lastReceive = this._lastReceive;
        receivedMsg.timeslot = this._lastReceive - this._syncTime;

        if (!receivedMsg.isValid) {
            logger.error(`checksum error: ${receivedMsg.code}, ${receivedMsg.isValid}`);
            return;
        }

        const foundIdx = this.findCommandIndex(packet, receivedMsg);
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

        const validMsgInfos = RS485_DEVICE.filter(({ type, dev, cmd }) => {
            return (type === packet[3] && dev === packet[5] && cmd === packet[9]);
        });

        const isValid = this.checksum(packet);
        const receivedMsg = {
            code,
            codeHex,
            count: 0,
            validMsgInfos,
        };
        receivedMsg.isValid = receivedMsg.validMsgInfos[0] ? isValid : true;
        _receivedMsgs.push(receivedMsg);

        return receivedMsg;
    }


    findCommandIndex(packet, msg) {
        return this._serialCmdQueue.findIndex(({ cmdHex }) => {
            return (packet[3] === 0xdc && cmdHex[5] === packet[5] && cmdHex[9] === packet[9]);
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
            retryCount: 0,
        };

        this._serialCmdQueue.push(serialCmd);
        logger.info(`send to device: ${cmdHex.toString('hex')}`);

        const elapsed = serialCmd.sentTime - this._syncTime;
        const delay = (elapsed < 300) ? 300 - elapsed : 0;

        setTimeout(() => this.processCommand(serialCmd), delay);
    }

    processCommand(serialCmd) {
        if (this._serialCmdQueue.length === 0) {
            return;
        }
        serialCmd = this._serialCmdQueue.shift();

        this._connWallpad.write(serialCmd.cmdHex, (err) => {
            if (err) {
                logger.error('send Error:', err.message);
            }
        });

        if (Options.rs485.max_retry > serialCmd.retryCount) {
            serialCmd.retryCount++;
            this._serialCmdQueue.push(serialCmd);
            setTimeout(() => this.processCommand(serialCmd), 300);
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
            'gas': [0xAA, 0x55, 0x30, 0xBC, 0x00, 0x2C, 0x00, 0x01, 0x00, 0x02,
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x1B, 0x0D, 0x0D],
            'elevator': [0xAA, 0x55, 0x30, 0xBC, 0x00, 0x01, 0x00, 0x44, 0x00, 0x01,
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x32, 0x0D, 0x0D],
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
        const OnOff = {
            'gas': 'off',
            'elevator': 'on',
        };
        const msgInfo = RS485_DEVICE.find(e => e.setPropertyToMsg && (device === e.name || OnOff.hasOwnProperty(device)));

        if (!msgInfo) {
            logger.warn(`   unknown device: ${device}`);
            return;
        }
        if (OnOff.hasOwnProperty(device) && value !== OnOff[device]) {
            logger.warn(`   unknown command: ${device}, ${value}`)
            return;
        }
        if (value == "") {
            logger.warn(`   no payload: ${device}`)
            return;
        }

        const cmdBuffer = Buffer.alloc(21);
        cmdBuffer.writeUIntBE(0xaa5530, 0, 3);
        cmdBuffer[3] = msgInfo.type;
        cmdBuffer[5] = msgInfo.dev;
        cmdBuffer[9] = msgInfo.cmd[0];
        msgInfo.setPropertyToMsg(cmdBuffer, room, name, value);
        cmdBuffer[18] = parseInt(this.makesum(cmdBuffer), 16);
        cmdBuffer.writeUint16BE(0x0d0d, 19, 21);

        const buffer = OnOff.hasOwnProperty(device) ? this.OnOffDevice(device, value) : cmdBuffer;
        this.addCommandToQueue(buffer, device, room, name, value, callback);

        /*
        let count = 0;
        let interval = setInterval(() => {
            count = count + 1;
            this.mqttDiscovery(Options.mqtt.prefix, device, room, name);

            if (count === 20) clearInterval(interval);
        }, 1000);
        */
    }

    updateProperty(device, room, name, value, force) {
        const propertyKey = device + room + name;
        const isSamePropertyValue = /*!force &&*/ this._deviceStatusCache[propertyKey] === value;
        if (isSamePropertyValue) return;

        this._deviceStatusCache[propertyKey] = value;

        let deviceStatus = this._deviceStatus.find(o => o.device === device && o.room === room);
        if (!deviceStatus) {
            deviceStatus = this.putStatusProperty(device, room);
        }
        deviceStatus.property[name] = value;

        this.mqttClientUpdate(device, room, name, value);
    }
}

new KocomRS485();
