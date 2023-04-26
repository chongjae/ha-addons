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
    //LENBUFFER,
    //HEDBUFFER,
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
            if (n === 'power') b[2] = 0x01, b[5] = (v === 'on' ? 0x01 : 0x00), b[6] = 0x01
            else b[2] = 0x03, b[6] = VENTTEMP[v];

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
            props.push({ device: 'light', room: b[5] & 0x0f, name: 'batch', value: (b[6] & 0x0F) ? 'on' : 'off' },
                { device: 'light', room: 'all', name: 'batch', value: (b[6] << 1) ? 'on' : 'off' });

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
            let val;
            if (VENTTEMPI.hasOwnProperty(b[6])) val = VENTTEMPI[b[6]];
            return [{ device: 'fan', room: '1', name: 'power', value: (b[5] ? 'on' : 'off') },
            { device: 'fan', room: '1', name: 'preset', value: val }];
        }
    },
    {
        device: 'gas', header: 0x023180, length: 10, request: 'ack',
        parseToProperty: (b) => {
            return [{ device: 'gas', room: '1', name: 'power', value: (b[5] ? 'on' : 'off') }];
        }
    },
    {
        device: 'doorlock', header: 0x024180, length: 10, request: 'ack',
        parseToProperty: (b) => {
            return [{ device: 'doorlock', room: '1', name: 'power', value: (b[5] === 0x52 ? 'off' : 'on') }];
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

class CustomParser extends Transform {
    constructor(options) {
        super(options);
        this.resetBuffer();
    }

    resetBuffer() {
        this.bufferQueue = [];
        this.bufferLengthCount = 0;
        this.expectedBufferLength = undefined;
        this.isHeaderFound = false;
        this.prefixBuffer = new Uint8Array([0x02]);
        this.headerBuffer = new Uint8Array([0x31, 0x41, 0x42, 0x17, 0xD1, 0x28, 0x61]);
    }

    _transform(chunk, encoding, done) {
        let start = 0;
        let prefixIndex = chunk.indexOf(this.prefixBuffer);
        while (prefixIndex >= 0) {
            let headerIndex = this.headerBuffer.indexOf(chunk[prefixIndex + 1]);
            if (headerIndex >= 0) {
                this.pushBufferedData();
                this.bufferQueue = [];
                start = prefixIndex;
                this.isHeaderFound = true;
                let expectedLength = this.parseExpectedLength(chunk, prefixIndex);
                if (expectedLength) {
                    this.expectedBufferLength = expectedLength;
                    this.isHeaderFound = false;
                } else {
                    this.resetBuffer();
                    return done();
                }
                if (this.bufferLengthCount === this.expectedBufferLength - 1) {
                    this.bufferQueue.push(chunk.slice(start, prefixIndex + this.expectedBufferLength + 1));
                    this.pushBufferedData();
                    this.bufferQueue = [];
                    start = prefixIndex + this.expectedBufferLength + 1;
                } else {
                    this.bufferLengthCount++;
                }
            }
            prefixIndex = chunk.indexOf(this.prefixBuffer, prefixIndex + 1);
        }
        this.bufferQueue.push(chunk.slice(start));
        done();
    }

    _flush(done) {
        this.pushBufferedData();
        this.resetBuffer();
        done();
    }

    parseExpectedLength(chunk, i) {
        let isHeaderValid = this.headerBuffer.includes(chunk[i + 1]);
        let expectedLength = chunk[i + 2];
        if (isHeaderValid && expectedLength <= 10) {
            return 10;
        }
        return expectedLength;
    }

    pushBufferedData() {
        if (this.bufferQueue.length > 0) {
            this.push(Buffer.concat(this.bufferQueue));
        }
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

    mqttDiscovery(prefix, device, room, name) {
        let topic;
        let payload;

        switch (device) {
            case 'light':
                topic = `homeassistant/light/bestin_wallpad/light_${room}_${name}/config`;
                payload = {
                    name: `bestin_light_${room}_${name}`,
                    cmd_t: `${prefix}/light/${room}/${name}/command`,
                    stat_t: `${prefix}/light/${room}/${name}/state`,
                    uniq_id: `bestin_light_${room}_${name}`,
                    pl_on: "on",
                    pl_off: "off",
                    device: {
                        ids: "bestin_wallpad",
                        name: "bestin_wallpad",
                        mf: "HDC BESTIN",
                        mdl: "HDC BESTIN Wallpad",
                        sw: "harwin1/ha-addons/bestin_wallpad",
                    },
                };
                break;
            case 'outlet':
                let outletCmt = name.includes("usage") ? "sensor" : "switch";
                topic = `homeassistant/${outletCmt}/bestin_wallpad/outlet_${room}_${name}/config`;
                payload = {
                    name: `bestin_outlet_${room}_${name}`,
                    cmd_t: `${prefix}/outlet/${room}/${name}/command`,
                    stat_t: `${prefix}/outlet/${room}/${name}/state`,
                    uniq_id: `bestin_outlet_${room}_${name}`,
                    pl_on: "on",
                    pl_off: "off",
                    ic: name.includes("usage") ? "mdi:lightning-bolt" : "mdi:power-socket-eu",
                    unit_of_meas: name.includes("usage") ? "Wh" : "",
                    device: {
                        ids: "bestin_wallpad",
                        name: "bestin_wallpad",
                        mf: "HDC BESTIN",
                        mdl: "HDC BESTIN Wallpad",
                        sw: "harwin1/ha-addons/bestin_wallpad",
                    },
                };
                break;
            case 'thermostat':
                topic = `homeassistant/climate/bestin_wallpad/thermostat_${room}/config`;
                payload = {
                    name: `bestin_thermostat_${room}`,
                    mode_cmd_t: `${prefix}/thermostat/${room}/power/command`,
                    mode_stat_t: `${prefix}/thermostat/${room}/power/state`,
                    temp_cmd_t: `${prefix}/thermostat/${room}/target/command`,
                    temp_stat_t: `${prefix}/thermostat/${room}/target/state`,
                    curr_temp_t: `${prefix}/thermostat/${room}/current/state`,
                    uniq_id: `bestin_thermostat_${room}`,
                    modes: ["off", "heat"],
                    min_temp: 5,
                    max_temp: 40,
                    temp_step: 0.5,
                    device: {
                        ids: "bestin_wallpad",
                        name: "bestin_wallpad",
                        mf: "HDC BESTIN",
                        mdl: "HDC BESTIN Wallpad",
                        sw: "harwin1/ha-addons/bestin_wallpad",
                    },
                };
                break;
            case 'fan':
                topic = `homeassistant/fan/bestin_wallpad/fan_${room}/config`;
                payload = {
                    name: `bestin_fan_${room}`,
                    cmd_t: `${prefix}/fan/${room}/power/command`,
                    stat_t: `${prefix}/fan/${room}/power/state`,
                    pr_mode_cmd_t: `${prefix}/fan/${room}/preset/command`,
                    pr_mode_stat_t: `${prefix}/fan/${room}/preset/state`,
                    pr_modes: ["low", "medium", "high"],
                    uniq_id: `bestin_fan_${room}`,
                    pl_on: "on",
                    pl_off: "off",
                    device: {
                        ids: "bestin_wallpad",
                        name: "bestin_wallpad",
                        mf: "HDC BESTIN",
                        mdl: "HDC BESTIN Wallpad",
                        sw: "harwin1/ha-addons/bestin_wallpad",
                    },
                };
                break;
            case 'gas':
                topic = `homeassistant/switch/bestin_wallpad/gas_${room}/config`;
                payload = {
                    name: `bestin_gas_${room}`,
                    cmd_t: `${prefix}/gas/${room}/power/command`,
                    stat_t: `${prefix}/gas/${room}/power/state`,
                    uniq_id: `bestin_gas_${room}`,
                    pl_on: "on",
                    pl_off: "off",
                    ic: "mdi:gas-cylinder",
                    device: {
                        ids: "bestin_wallpad",
                        name: "bestin_wallpad",
                        mf: "HDC BESTIN",
                        mdl: "HDC BESTIN Wallpad",
                        sw: "harwin1/ha-addons/bestin_wallpad",
                    },
                };
                break;
            case 'energy':
                topic = `homeassistant/sensor/bestin_wallpad/${room}_${name}/config`;
                payload = {
                    name: `bestin_${room}_${name}`,
                    stat_t: `${prefix}/energy/${room}/${name}/state`,
                    unit_of_meas: room === "electric" ? "kWh" : "m³",
                    uniq_id: `bestin_${room}_${name}`,
                    device: {
                        ids: "bestin_wallpad",
                        name: "bestin_wallpad",
                        mf: "HDC BESTIN",
                        mdl: "HDC BESTIN Wallpad",
                        sw: "harwin1/ha-addons/bestin_wallpad",
                    },
                };
                break;
            case 'elevator':
            case 'evstate':
            case 'evdirection':
                let evCmt = device === "elevator" ? "switch" : "sensor";
                topic = `homeassistant/${evCmt}/bestin_wallpad/${device}_${room}/config`;
                payload = {
                    name: `bestin_${device}_${room}`,
                    cmd_t: `${prefix}/${device}/${room}/${name}/command`,
                    stat_t: `${prefix}/${device}/${room}/${name}/state`,
                    uniq_id: `bestin_${device}_${room}`,
                    ic: "mdi:elevator",
                    device: {
                        ids: "bestin_wallpad",
                        name: "bestin_wallpad",
                        mf: "HDC BESTIN",
                        mdl: "HDC BESTIN Wallpad",
                        sw: "harwin1/ha-addons/bestin_wallpad",
                    },
                };
                break;
            case 'doorlock':
                topic = `homeassistant/switch/bestin_wallpad/doorlock_${room}/config`;
                payload = {
                    name: `bestin_doorlock_${room}`,
                    cmd_t: `${prefix}/doorlock/${room}/power/command`,
                    stat_t: `${prefix}/doorlock/${room}/power/state`,
                    uniq_id: `bestin_doorlock_${room}`,
                    pl_on: "on",
                    pl_off: "off",
                    ic: 'mdi:lock',
                    device: {
                        ids: "bestin_wallpad",
                        name: "bestin_wallpad",
                        mf: "HDC BESTIN",
                        mdl: "HDC BESTIN Wallpad",
                        sw: "harwin1/ha-addons/bestin_wallpad",
                    },
                };
                break;
        }

        this._mqttClient.publish(topic, JSON.stringify(payload), { retain: true });
    }

    // 패킷 체크섬 검증
    verifyCheckSum(packet) {
        let result = 0x03;
        for (let i = 0; i < packet.length; i++) {
            result ^= packet[i];
            result = (result + 1) & 0xFF;
        }
        return result;
    }

    // 명령 패킷 마지막 바이트(crc) 생성
    generateCheckSum(packet) {
        let result = 0x03;
        for (let i = 0; i < packet.length - 1; i++) {
            result ^= packet[i];
            result = (result + 1) & 0xFF;
        }
        return result;
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

            this._connection.pipe(new CustomParser()).on('data', this.packetHandle.bind(this));
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
            this._connection.pipe(new CustomParser()).on('data', this.packetHandle.bind(this));
        }
        return this._connection;
    }

    packetHandle(data) {
        //console.log(data.toString('hex'))
        this._lastReceive = new Date();
        if (data[0] === 0x02 && data[1] !== 0x41) {
            this._syncTime = this._lastReceive;
            this._timestamp = data[4];
        }

        const { _receivedMsgs } = this;
        const receivedMsg = _receivedMsgs.find(({ codeHex }) => codeHex.equals(data)) || {
            code: data.toString('hex'),
            codeHex: data,
            count: 0,
            info: MSG_INFO.filter(({ header, length }) => {
                const expectLength = data[2] === data.length ? 4 : 3;
                const actualLength = data.length;
                const actualHeader = parseInt(data.subarray(0, expectLength).toString('hex'), 16);

                if (header === actualHeader && length === actualLength) return actualHeader;
            }),
        };
        receivedMsg.checksum = this.verifyCheckSum(data);
        receivedMsg.count++;
        receivedMsg.lastlastReceive = receivedMsg.lastReceive;
        receivedMsg.lastReceive = this._lastReceive;
        receivedMsg.timeslot = this._lastReceive - this._syncTime;

        if (!Boolean(receivedMsg.checksum)) {
            logger.error(`checksum error: ${receivedMsg.code}, ${receivedMsg.checksum.toString(16)}`);
            return;
        }

        const foundIdx = this._serialCmdQueue.findIndex(e =>
            (e.cmdHex[1] === data[1]) && (([0x81, 0x82, 0x83].includes(data[2])) || ([0x81, 0X82, 0x92].includes(data[3])))
        );
        if (foundIdx > -1) {
            logger.info(`success command: ${this._serialCmdQueue[foundIdx].device}`);
            const { callback, device } = this._serialCmdQueue[foundIdx];
            if (callback) callback(receivedMsg);
            this._serialCmdQueue.splice(foundIdx, 1);
        }
        for (const msgInfo of receivedMsg.info) {
            if (msgInfo.parseToProperty) {
                const propArray = msgInfo.parseToProperty(data);
                for (const { device, room, name, value } of propArray) {
                    this.updateProperty(device, room, name, value, foundIdx > -1);
                }
            }
        }

        //if (CONFIG.rs485.dump_time > 0) {
        //    let count = 0;
        //    logger.info(`packet dump set dump time: ${CONFIG.rs485.dump_time}s`)
        //    const intervalId = setInterval(() => {
        //        fs.writeFileSync('logs/packet_dump.txt', data.toString('hex') + '\n', { flag: 'a' });
        //        count = count + 1;
        //        if (count === CONFIG.rs485.dump_time) {
        //            logger.info('packet dump finish. to file packet_dump.txt')
        //            clearInterval(intervalId);
        //        }
        //    }, 1000);
        //}
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
            logger.warn(`maximum retries ${CONFIG.rs485.max_retry} times exceeded for command`);
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
            'lightbatch': [0x02, 0x31, 0x0B, 0x02, 0x31, 0x3f, 0x00, 0x00, 0x00, 0x00, 0x51],
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

        //if (!fs.existsSync('./session.json')) {
        fs.writeFileSync('./session.json', JSON.stringify(data));
        logger.info(`session.json file write successful!`);
        //}

        const json = JSON.parse(fs.readFileSync('./session.json'));
        format(isV1 ? V1LIGHTSTATUS : V2LIGHTSTATUS, isV1 ? json.phpsessid : json.url, isV1 ? json.userid : json['access-token'], isV1 ? json.username : null);

        const statusUrl = isV1 ? V1LIGHTSTATUS : V2LIGHTSTATUS;
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
