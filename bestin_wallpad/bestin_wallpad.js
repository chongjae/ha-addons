/*
 * @description bestin_wallpad.js
 * @author harwin1
 */

const logger = require('./logger.js');
const SerialPort = require('serialport').SerialPort;
const CONFIG = require('/data/options.json');

const Transform = require('stream').Transform;

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
    OnOff
} = require('./const.js');

const MSG_INFO = [
    ///////////////////////
    //command <-> response
    {
        device: 'light', header: 0x02310D01, length: 13, request: 'set',
        setPropertyToMsg: (b, i, n, v) => {
            let id = n.slice(-1) - 1, pos = (v === 'on' ? 0x80 : 0x00), onff = (v === 'on' ? 0x04 : 0x00);

            b[5] = i & 0x0f;
            if (n === 'batch') b[6] = (v === 'on' ? 0x8f : 0x0f);
            else b[6] = (0x01 << id | pos);
            b[11] = onff;

            return b;
        }
    },
    {
        device: 'outlet', header: 0x02310D01, length: 13, request: 'set',
        setPropertyToMsg: (b, i, n, v) => {
            let id = n.slice(-1) - 1, pos = (v === 'on' ? 0x80 : 0x00), onff = (v === 'on' ? 0x09 << id : 0x00);

            b[5] = i & 0x0F;
            if (n === 'standby') b[8] = (v === 'on' ? 0x83 : 0x03);
            else if (n === 'batch') b[7] = (v === 'on' ? 0x8f : 0x0f), b[11] = onff;
            else b[7] = (0x01 << id | pos), b[11] = onff;

            return b;
        }
    },


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
    {
        device: 'fan', header: 0x026100, length: 10, request: 'set',
        setPropertyToMsg: (b, i, n, v) => {
            if (n === 'power') b[2] = 0x01, b[5] = (v === 'on' ? 0x01 : 0x00), b[6] = 0x01;
            else if (n === 'timer') b[2] = 0x04, b[7] = v.toString(16);
            else b[2] = (v === 'nature' ? 0x07 : 0x03), b[6] = VENTTEMP[v];

            return b;
        }
    },

    /////////////////////
    //query <-> response
    {
        device: 'light', header: 0x02311E91, length: 30, request: 'ack',
        parseToProperty: (b) => {

            let props = [];
            for (let i = 0; i < ((b[5] & 0x0f) === 1 ? 4 : 2); i++) {
                props.push({ device: 'light', room: b[5] & 0x0f, name: `power${i + 1}`, value: (b[6] & (1 << i)) ? 'on' : 'off' })
            }
            props.push({ device: 'light', room: b[5] & 0x0f, name: 'batch', value: (b[6] & 0x0F) ? 'on' : 'off' });

            return props;
        }
    },
    {
        device: 'outlet', header: 0x02311E91, length: 30, request: 'ack',
        parseToProperty: (b) => {

            let props = [];
            for (let i = 0; i < ((b[5] & 0x0f) === 1 ? 3 : 2); i++) {
                let i1 = 14 + 2 * i, cons = (b[i1] << 4 | b[i1 + 1]) / 10 || 0;

                props.push({ device: 'outlet', room: b[5] & 0x0f, name: `power${i + 1}`, value: (b[7] & (1 << i)) ? 'on' : 'off' },
                    { device: 'outlet', room: b[5] & 0x0f, name: `usage${i + 1}`, value: cons })
            }
            props.push({ device: 'outlet', room: b[5] & 0x0f, name: 'batch', value: (b[7] & 0x0F) ? 'on' : 'off' },
                { device: 'outlet', room: b[5] & 0x0f, name: 'standby', value: (b[7] >> 4 & 1) ? 'on' : 'off' });

            return props;
        }
    },

    {
        device: 'thermostat', header: 0x02281091, length: 16, request: 'ack',
        parseToProperty: (b) => {

            return [{ device: 'thermostat', room: b[5] & 0x0f, name: 'power', value: (b[6] & 0x01) ? 'heat' : 'off' },
            { device: 'thermostat', room: b[5] & 0x0f, name: 'target', value: (b[7] & 0x3f) + ((b[7] & 0x40) && 0.5) },
            { device: 'thermostat', room: b[5] & 0x0f, name: 'current', value: ((b[8] << 8) + b[9]) / 10.0 }];
        }
    },
    {
        device: 'fan', header: 0x026180, length: 10, request: 'ack',
        parseToProperty: (b) => {
            if (VENTTEMPI.hasOwnProperty(b[6])) var val = VENTTEMPI[b[6]];
            return [{ device: 'fan', room: '1', name: 'power', value: (b[5] ? 'on' : 'off') },
            { device: 'fan', room: b[5], name: 'preset', value: b[5] === 0x11 ? 'nature' : val },
            { device: 'fan', room: b[5], name: 'timer', value: b[7].toString(10) }];
        }
    },
    {
        device: 'gas', header: 0x023180, length: 10, request: 'ack',
        parseToProperty: (b) => {
            return [{ device: 'gas', room: b[5], name: 'power', value: (b[5] ? 'on' : 'off') },
                    { device: 'gas', room: b[5], name: 'cutoff', value: (b[5] ? '열림' : '닫힘') }];
        }
    },
    {
        device: 'doorlock', header: 0x024180, length: 10, request: 'ack',
        parseToProperty: (b) => {
            return [{ device: 'doorlock', room: b[5], name: 'power', value: (b[5] === 0x51 ? 'off' : 'on') }];
        }
    },

    {
        device: 'energy', header: 0x02D13082, length: 48, request: 'ack',
        parseToProperty: (b) => {
            let props = [], idx = 13;

            for (const elem of ['electric', 'heat', 'hotwater', 'gas', 'water']) {
                cons = Number(b.slice(idx, idx + 2).toString('hex'));
                props.push({ device: 'energy', room: elem, name: 'consumption', value: cons });
                idx += 8;
            }
            return props;
        }
    },
];


const DISCOVERY_DEVICE = {
    'ids': ['bestin_wallpad'],
    'name': 'bestin_wallpad',
    'mf': "HDC BESTIN",
    'mdl': "Bestin Wallpad",
    'sw': "harwin1/ha-addons/bestin_wallpad",
};

const DISCOVERY_PAYLOAD = {
    light: [{
        _intg: 'light',
        name: '{0}_light_{1}_{2}',
        cmd_t: '{0}/light/{1}/{2}/command',
        stat_t: '{0}/light/{1}/{2}/state',
        pl_on: "on",
        pl_off: "off",
    }, 
    {
        _intg: 'button',
        name: '{0}_light_all',
        cmt_t: '{0}/light/all/cutoff/command'
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
    },
    {
        name: '{0}_fan_timer',
        cmd_t: '{0}/fan/{1}/timer/command',
        stat_t: '{0}/fan/{1}/timer/state',
        min: 0,
        max: 240,
        unit_of_measurement: 'Minute',
    }],
    thermostat: [{
        _intg: 'climate',
        name: '{0}_thermostat_{1}',
        mode_cmd_t: '{0}/thermostat/{1}/power/command',
        mode_stat_t: '{0}/thermostat/{1}/power/state',
        temp_cmd_t: '{0}/thermostat/{1}/target/command',
        temp_stat_t: '{0}/thermostat/{1}/target/state',
        curr_temp_t: '{0}/thermostat/{1}/current/state',
        modes: ["off", "heat"],
        min_temp: 5,
        max_temp: 40,
        temp_step: 0.5,
    }],
    energy: [{
        _intg: 'sensor'
        name: '{0}_{1}_{2}',
        stat_t: '{0}/energy/{1}/{2}/state',
        unit_of_meas: '{3}'
    }],
    doorlock: [{
        _intg: 'switch',
        name: '{0}_doorlock',
        cmd_t: '{0}/doorlock/{1}/power/command',
        stat_t: '{0}/doorlock/{1}/power/state',
        pl_on: "on",
        pl_off: "off",
        icon: 'mdi:lock'
    }],
    elevator: [{
        _intg: 'switch',
        name: '{0}_elevator',
        cmd_t: '{0}/elevator/{1}/call/command',
        stat_t: '{0}/elevator/{1}/call/state',
        pl_on: "on",
        pl_off: "off",
        icon: 'mdi:elevator'
    },
    {
        _intg: 'sensor',
        name: '{0}_evdirection',
        stat_t: '{0}/elevator/{1}/event/state',
        icon: 'mdi:elevator'
    },
    {
        _intg: 'sensor',
        name: '{0}_evstate',
        stat_t: '{0}/elevator/{1}/floor/state',
        icon: 'mdi:elevator'
    }]
};

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
            expectedLength = 10;
        } else if (chunk[i + 1] === 0x61) {
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
        this._connEnergy = this.createConnection(CONFIG.energy, 'energy');
        this._connControl = this.createConnection(CONFIG.control, 'control');
        this.serverCreate(CONFIG.server_enable, CONFIG.server_type);
    }

    mqttClient() {
        const client = mqtt.connect({
            host: CONFIG.mqtt.broker,
            port: CONFIG.mqtt.port,
            username: CONFIG.mqtt.username,
            password: CONFIG.mqtt.password,
            keepalive: 60, 
            reconnect: true, 
            reconnectInterval: 1000 
        });

        client.on('connect', () => {
            logger.info('MQTT connection successful!');
            this._mqttConnected = true;
            const topics = ['bestin/+/+/+/command', 'homeassistant/status'];
            topics.forEach(topic => {
                client.subscribe(topic, (err) => {
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
        let sert = CONFIG.server_type;
        let json;
        if (topics[0] !== CONFIG.mqtt.prefix) {
            return;
        }

        const cmdtopic = `${topics[0]}/${topics[1]}/${topics[2]}/${topics[3]}/command`;
        if (CONFIG.server_enable) {
            json = JSON.parse(fs.readFileSync('./session.json'));
        }

        logger.info(`recv. message: ${cmdtopic} = ${value}`);
        if (topics[2] === 'livingroom') {
            const unitNum = topics[3].replace(/power/g, 'switch');
            this.serverLightCommand(unitNum, value, sert, json);
        } else if (topics[1] === 'elevator' && sert === 'v2') {
            this.serverEvCommand(value, json);
        } else {
            const [device, room, name] = topics.slice(1, 4);
            if (device === 'light' && room === 'all' && sert === 'v2') {
                this.serverLightCommand('all', 'off', 'v2', json);
            }
            this.setCommandProperty(device, room, name, value);
        }
    }

    mqttClientUpdate(device, room, name, value) {
        if (!this._mqttConnected) {
            return;
        }
        const prefix = CONFIG.mqtt.prefix;
        const topic = `${prefix}/${device}/${room}/${name}/state`;

        if (typeof value !== 'number') {
            logger.info(`publish to mqtt: ${topic} = ${value}`);
        }
        this._mqttClient.publish(topic, String(value), { retain: true });
    }
       
    mqttDiscovery(pref, dev, rm, nm) {
        let payloads = DISCOVERY_PAYLOAD[dev];

        for (let i = 0; i < payloads.length; i++) {
            let payload = JSON.parse(JSON.stringify(payloads[i]));

            this.format(payload, pref, rm, nm, rm === 'electric' ? 'kWh' : 'm³');
            payload['name'] = payload['name'].replace('power', '');

            payload['uniq_id'] = payload['name'];
            payload['device'] = DISCOVERY_DEVICE;

            const topic = `homeassistant/${payload['_intg']}/bestin_wallpad/${payload['name']}/config`;
            this._mqttClient.publish(topic, JSON.stringify(payload), { retain: true });
        }
    }

    // 패킷 체크섬 검증
    verifyCheckSum(packet) {
        let sum = 3;
        for (let i = 0; i < packet.length - 1; i++) {
            sum ^= packet[i];
            sum = (sum + 1) & 0xFF;
        }
        return sum === packet[packet.length - 1];
    }

    // 명령 패킷 마지막 바이트(crc) 생성
    generateCheckSum(packet) {
        let sum = 3;
        for (let i = 0; i < packet.length - 1; i++) {
            sum ^= packet[i];
            sum = (sum + 1) & 0xFF;
        }
        return sum;
    }

    createConnection(options, name) {
        if (options.path === "" && options.address === "") {
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
        //console.log(packet.toString('hex'))
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
        _receivedMsgs.push(receivedMsg);
        return receivedMsg;
    }

    findCommandIndex(packet, msg) {
        return this._serialCmdQueue.findIndex(({ cmdHex }) => {
            const i = cmdHex.length === 10 ? 2 : 3;
            const ackHex = ((cmdHex[1] === 0x28 ? 0x9 : 0x8) << 4) | cmdHex[i] & 0x0f;
            return (cmdHex[1] === packet[1] && "0x"+ackHex.toString(16) == packet[i]);
        });
    }

    updateProperties(msgInfo, packet, isCommandResponse) {
        if (!msgInfo.parseToProperty) return;

        const propArray = msgInfo.parseToProperty(packet);
        for (const { device, room, name, value } of propArray) {
            this.updateProperty(device, room, name, value, isCommandResponse);
        }
    }

    //if (CONFIG.rs485.dump_time > 0) {
    //    let count = 0;
    //    logger.info(`packet dump set dump time: ${CONFIG.rs485.dump_time}s`)
    //    const intervalId = setInterval(() => {
    //        fs.writeFileSync('logs/packet_dump.txt', packet.toString('hex') + '\n', { flag: 'a' });
    //        count = count + 1;
    //        if (count === CONFIG.rs485.dump_time) {
    //            logger.info('packet dump finish. to file packet_dump.txt')
    //            clearInterval(intervalId);
    //        }
    //    }, 1000);
    //}

    addCommandToQueue(cmdHex, device, room, name, value, callback) {
        const serialCmd = {
            cmdHex,
            device,
            room,
            property: name,
            value: value,
            callback,
            sentTime: new Date(),
            retryCount: CONFIG.rs485.max_retry
        };

        this._serialCmdQueue.push(serialCmd);
        logger.info(`send to device: ${cmdHex.toString('hex')}`);

        const elapsed = serialCmd.sentTime - this._syncTime;
        const delay = (elapsed < 100) ? 100 - elapsed : 0;

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

        if (!writeHandle) {
            logger.error(`invalid device: ${serialCmd.device}`);
            return;
        }

        writeHandle.write(serialCmd.cmdHex, (err) => {
            if (err) {
                logger.error('send Error:', err.message);
            }
        });

        if (serialCmd.retryCount > 0) {
            serialCmd.retryCount--;
            this._serialCmdQueue.push(serialCmd);
            setTimeout(() => this.processCommand(serialCmd), 100);
        } else {
            logger.warn(`command(${serialCmd.device}) has exceeded the maximum retry limit of ${CONFIG.rs485.max_retry} times`);
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
        const msgInfo = MSG_INFO.find(e => e.setPropertyToMsg && (ownProp === e.device || OnOff.hasOwnProperty(ownProp)));

        if (!msgInfo) {
            logger.warn(`   unknown device: ${device}`);
            return;
        }
        if (OnOff.hasOwnProperty(ownProp) && value !== OnOff[ownProp]) {
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

        const buffer = OnOff.hasOwnProperty(ownProp) ? this.OnOffDevice(ownProp, value) : cmdHex;
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
            if (!this._discovery && CONFIG.mqtt.discovery) {
                this.mqttDiscovery(CONFIG.mqtt.prefix, device, room, name);
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
        loginFunc();
        setInterval(loginFunc, type === 'v1' ? 1200000 : 3600000);
    }

    serverLogin() {
        request.get(V1LOGIN, (error, response, body) => {
            if (error) {
                logger.error(`i-park v1 server login failed with error code: ${error}`);
                return;
            }

            const parse = JSON.parse(body);
            if (response.statusCode === 200 && parse.ret === 'success') {
                logger.info('i-park v1 server login successful');
                this.loginManagement(response, 'v1');
            } else {
                logger.warn(`i-park v1 server login failed: ${parse.ret}`);
            }
        });
    }

    serverLogin2() {
        request.post(V2LOGIN, (error, response, body) => {
            if (error) {
                logger.error(`i-park v2 server login failed with error code: ${error}`);
                return;
            }

            const parse = JSON.parse(body);
            if (response.statusCode === 200) {
                logger.info('i-park v2 server login successful');
                this.loginManagement(parse, 'v2');
            } else {
                logger.error(`i-park v2 server error statusCode: ${response.statusCode}`);
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

    reJson(obj) {
        return JSON.parse(JSON.stringify(obj));
    }

    loginManagement(res, type) {
        const format = this.format.bind(this);

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
            logger.info(`session.json file write successful!`);
        } catch (err) {
            logger.error(`session.json file write fail. [${err}]`);
            return;
        }

        const json = JSON.parse(fs.readFileSync('./session.json'));
        
        const statusUrl = isV1 ? format(this.reJson(V1LIGHTSTATUS), json.phpsessid, json.userid, json.username) : format(this.reJson(V2LIGHTSTATUS), json.url, json['access-token']);
        const lightStatFunc = this.getServerLightStatus.bind(this);
        lightStatFunc(statusUrl, type);
        setInterval(lightStatFunc, CONFIG.server.scan_interval * 1000, statusUrl, type);

        if (!isV1) {
            format(V2EVSTATUS, json.url.split('://')[1]);
            this.getServerEVStatus(V2EVSTATUS);
        }
    }

    getServerLightStatus(url, type) {
        request.get(url, (error, response, body) => {
            if (error) {
                logger.error(`failed to retrieve server light status: ${error}`);
                return;
            }

            if (response.statusCode !== 200) {
                logger.error(`failed to retrieve server light status: status code ${response.statusCode}`);
                return;
            }

            logger.info('server light status request successful!');

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
                logger.warn('Failed to parse XML light status: status_info property not found');
                return;
            }

            statusInfo.forEach(status => {
                const device = 'light';
                const room = 'livingroom';
                const unitNum = status.$.unit_num.replace(/switch/g, 'power');
                const unitStatus = status.$.unit_status;

                this.updateProperty(device, room, unitNum, unitStatus);
            });
        });
    }

    parseJsonLightStatus(json) {
        let data;

        try {
            data = JSON.parse(json);
        } catch (err) {
            logger.error(`failed to parse JSON light status: ${err}`);
            return;
        }

        const units = data?.units;

        if (!units) {
            logger.warn('failed to parse JSON light status: units property not found');
            return;
        }

        units.forEach((unit) => {
            const device = 'light';
            const room = 'livingroom';
            const unitNum = unit.unit.replace(/switch/g, 'power');

            this.updateProperty(device, room, unitNum, unit.state);
        });
    }

    getServerEVStatus(url) {
        const req = https.request(url, res => {

            res.on('data', d => {
                const resStr = d.toString();
                const resLines = resStr.split('\n');

                const evEvent = resLines[1].substring(7);
                const evInfo = JSON.parse(resLines[2].substring(5));

                if (evInfo.address !== CONFIG.server.address) {
                    //logger.warn('unable to find information on the elevator for the generation');
                    return;
                } else {
                    const device = 'elevator';
                    const room = '1';
                    const state = evEvent === 'arrived' ? 'off' : 'on';

                    this.updateProperty(device, room, 'call', state);
                }

                if (evEvent || evEvent == null) {
                    const device = 'evdirection';
                    const room = '1';

                    this.updateProperty(device, room, 'event', EVSTATE[evEvent] ?? '대기 층')
                } if (evInfo.move_info) {
                    const device = 'evstate';
                    const room = '1';

                    this.updateProperty(device, room, 'floor', evInfo.move_info.Floor + ' Floor')
                }
            });
        });

        req.on('error', error => {
            log.error(error);
        });

        req.end();
    }

    serverLightCommand(unit, state, type, json) {
        let url;
        if (type === 'v1') {
            url = this.format(this.reJson(V1LIGHTCMD), json.phpsessid, json.userid, json.username, unit, state);
        } else {
            url = this.format(this.reJson(V2LIGHTCMD), json.url, unit.slice(-1), unit, state, json['access-token']);
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
            const room = 'livingroom';

            if (unit !== 'all') {
                this.updateProperty(device, room, unit.replace(/switch/g, 'power'), state);
            } else {
                for (const i of ['power1', 'power2', 'power3']) {
                    this.updateProperty(device, room, i, state);
                }
            }
        });
    }

    serverEvCommand(state, json) {
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
