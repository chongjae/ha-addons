/** 
 * @description bestin_wallpad.js
 * @author harwin1
 */

const log = require('simple-node-logger').createSimpleLogger();
const SerialPort = require('serialport').SerialPort;
const CONFIG = require('./config.json').options;

const Transform = require('stream').Transform;

const request = require('request');
const xml2js = require('xml2js');
const mqtt = require('mqtt');
const net = require('net');

const {
    V1LOGIN,
    V2LOGIN,
    V1LIGHTSTATUS,
    V2LIGHTSTATUS,
    V1LIGHTCMD,
    V2HDCLOGIN,
    V2EVSTATUS,
    V2ELEVATORCMD,
    V2LIGHTCMD,
    VENTEMPSTR,
    VENTEMPINT
} = require('./const.js');

const MSG_INFO = [
    ///////////////////////
    //command <-> response
    {
        device: 'light', header: 0x02310D01, length: 13, request: 'set',
        setPropertyToMsg: (b, i, n, v) => {
            let id = n.slice(-1) - 1, pos = (v == 'on' ? 0x80 : 0x00), onff = (v == 'on' ? 0x04 : 0x00);

            b[5] = i & 0x0F;
            if (n == 'batch') b[6] = (v == 'on' ? 0x8F : 0x0F)
            else b[6] = (0x01 << id | pos);
            b[11] = onff;

            return b;
        }
    },
    {
        device: 'outlet', header: 0x02310D01, length: 13, request: 'set',
        setPropertyToMsg: (b, i, n, v) => {
            let id = n.slice(-1) - 1, pos = (v == 'on' ? 0x80 : 0x00), onff = (v == 'on' ? 0x09 << id : 0x00);

            b[5] = i & 0x0F;
            if (n == 'standby') b[8] = (v == 'on' ? 0x83 : 0x03)
            else if (n == 'batch') b[7] = (v == 'on' ? 0x8F : 0x0F), b[11] = onff
            else b[7] = (0x01 << id | pos), b[11] = onff;

            return b;
        }
    },


    {
        device: 'thermostat', header: 0x02280E12, length: 14, request: 'set',
        setPropertyToMsg: (b, i, n, v) => {
            let power = (v == 'heat' ? 0x01 : 0x02), val = parseFloat(v), vInt = parseInt(val), vFloat = val - vInt;

            b[5] = i & 0x0F;
            if (n == 'power') b[6] = power
            else b[7] = ((vInt & 0xFF) | ((vFloat != 0) ? 0x40 : 0x00));

            return b;
        }
    },
    {
        device: 'ventil', header: 0x026100, length: 10, request: 'set',
        setPropertyToMsg: (b, i, n, v) => {
            if (n == 'power') b[2] = 0x01, b[5] = (v == 'on' ? 0x01 : 0x00), b[6] = 0x01
            else b[2] = 0x03, b[6] = VENTEMPSTR[v];

            return b;
        }
    },

    /////////////////////
    //query <-> response
    {
        device: 'light', header: 0x02311E91, length: 30, request: 'ack',
        parseToProperty: (b) => {
            const propArr = [], roomIdx = b[5] & 0x0F;

            for (let i = 0; i < ((b[5] & 0x0F) == 1 ? ((b[6] >> 4 & 1) + 3) : 2); i++) {
                propArr.push(
                    ...[{ propertyName: 'power' + (i + 1), propertyValue: ((b[6] & (1 << i)) ? 'on' : 'off') },
                    { propertyName: 'batch', propertyValue: ((b[6] & 0x0F) ? 'on' : 'off') },
                    ].map(prop => ({
                        device: 'light',
                        roomIdx,
                        ...prop
                    }))
                );
            }
            return propArr;
        }
    },
    {
        device: 'outlet', header: 0x02311E91, length: 30, request: 'ack',
        parseToProperty: (b) => {
            const propArr = [], roomIdx = b[5] & 0x0F;

            for (let i = 0; i < ((b[5] & 0x0F) == 1 ? 3 : 2); i++) {
                const i1 = 14 + 2 * i, consumption = (b[i1] << 4 | b[i1 + 1]) / 10 || 0;

                propArr.push(
                    ...[{ propertyName: `power${i + 1}`, propertyValue: (b[7] & (1 << i)) ? 'on' : 'off' },
                    { propertyName: `usage${i + 1}`, propertyValue: consumption },
                    { propertyName: 'standby', propertyValue: (b[7] >> 4 & 1) ? 'on' : 'off' },
                    { propertyName: 'batch', propertyValue: (b[7] & 0x0F) ? 'on' : 'off' }
                    ].map(prop => ({
                        device: 'outlet',
                        roomIdx,
                        ...prop
                    }))
                );
            }
            return propArr;
        }
    },

    {
        device: 'thermostat', header: 0x02281091, length: 16, request: 'ack',
        parseToProperty: (b) => {
            const propArr = [], roomIdx = b[5] & 0x0F;

            propArr.push(
                ...[{ propertyName: 'power', propertyValue: (b[6] & 0x01) ? 'heat' : 'off' },
                { propertyName: 'setting', propertyValue: (b[7] & 0x7F) + (b[7] & 0x40 ? 0.5 : 0) },
                { propertyName: 'current', propertyValue: (b[8] << 8 | b[9]) / 10 }
                ].map(prop => ({
                    device: 'thermostat',
                    roomIdx,
                    ...prop
                }))
            );
            return propArr;

        }
    },
    {
        device: 'ventil', header: 0x026180, length: 10, request: 'ack',
        parseToProperty: (b) => {
            return [
                { device: 'ventil', roomIdx: 1, propertyName: 'power', propertyValue: (b[5] ? 'on' : 'off') },
                { device: 'ventil', roomIdx: 1, propertyName: 'preset', propertyValue: VENTEMPINT[b[6]] },
            ];
        }
    },
    {
        device: 'gas', header: 0x023180, length: 10, request: 'ack',
        parseToProperty: (b) => {
            return [{ device: 'gas', roomIdx: 1, propertyName: 'power', propertyValue: (b[5] ? 'on' : 'off') }];
        }
    },


    {
        device: 'energy', header: 0x02D13082, length: 48, request: 'ack',
        parseToProperty: (b) => {
            let propArr = [], idx = 13;

            for (const elem of ['elec', 'heat', 'hwater', 'gas', 'water']) {
                consumption = Number(b.slice(idx, idx + 2).toString('hex'));
                propArr.push({ device: 'energy', roomIdx: elem, propertyName: 'home', propertyValue: consumption });
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
        this._lenCount = 0;
        this._length = undefined;
        this._typeFlag = false;
        this._prefix = 0x02;
        this._headers = [0x31, 0x41, 0x42, 0xD1, 0x28, 0x61];
    }

    _transform(chunk, encoding, done) {
        let start = 0;
        for (let i = 0; i < chunk.length; i++) {
            if (this._prefix === chunk[i] && this._headers.includes(chunk[i + 1])) {
                this.push(Buffer.concat(this._queueChunk));
                this._queueChunk = [];
                start = i;
                this._typeFlag = true;
            } else if (this._typeFlag) {
                const expectedLength = this.expectedLength(chunk, i);
                if (expectedLength) {
                    this._length = expectedLength;
                    this._typeFlag = false;
                } else {
                    this.reset();
                    return done();
                }
            }

            if (this._lenCount === this._length - 1) {
                this._queueChunk.push(chunk.slice(start, i + 1));
                this.push(Buffer.concat(this._queueChunk));
                this._queueChunk = [];
                start = i + 1;
            } else {
                this._lenCount++;
            }
        }
        this._queueChunk.push(chunk.slice(start));
        done();
    }

    _flush(done) {
        this.push(Buffer.concat(this._queueChunk));
        this.reset();
        done();
    }

    expectedLength(packet, index) {
        const secondByte = packet[index];
        const thirdByte = packet[index + 1];

        if ([0x31, 0x61].includes(secondByte) && [0x00, 0x80, 0x82].includes(thirdByte)) {
            return 10;
        } else {
            return thirdByte;
        }
    }
}

class rs485 {
    constructor() {
        this._receivedMsgs = [];
        this._deviceReady = false;
        this._syncTime = new Date();
        this._lastReceive = new Date();
        this._commandQueue = new Array();
        this._serialCmdQueue = new Array();
        this._deviceStatusCache = {};
        this._deviceStatus = [];
        this._connection = null;
        this._loginInfo = {};

        this._mqttClient = this.mqttClient();
        this._connEnergy = this.createConnection(CONFIG.energy, 'energy');
        this._connControl = this.createConnection(CONFIG.control, 'control');
        this.serverCreate(CONFIG.server_enable, CONFIG.server_type);
    }

    mqttClient() {
        const client = mqtt.connect(`mqtt://${CONFIG.mqtt.broker}`, {
            port: CONFIG.mqtt.port,
            username: CONFIG.mqtt.username,
            password: CONFIG.mqtt.password,
            //clientId: '',
        });

        client.on('connect', () => {
            log.info('MQTT connection successful!');
            this._deviceReady = true;
            const topics = ['bestin/+/+/+/command', 'homeassistant/status'];
            topics.forEach(topic => {
                client.subscribe(topic, (err) => {
                    if (err) {
                        log.error(`failed to subscribe to ${topic}`);
                    }
                });
            });
        });

        client.on('error', (err) => {
            log.error(`MQTT connection error: ${err}`);
            this._deviceReady = false;
        });

        client.on('reconnect', () => {
            log.warn('MQTT connection lost. try to reconnect...');
        });
        log.info('initializing mqtt...');

        client.on('message', this.mqttCommand.bind(this));
        return client;
    }

    mqttCommand(topic, message) {
        if (!this._deviceReady) {
            log.warn('MQTT is not ready yet');
            return;
        }
        const topics = topic.split("/");
        const value = message.toString();
        if (topics[0] !== CONFIG.mqtt.prefix) {
            return;
        }

        const cmdTopic = `${topics[0]}/${topics[1]}/${topics[2]}/${topics[3]}/command`;
        log.info(`recv. message: ${cmdTopic} = ${value}`);
        if (topics[2] == 'livingroom') {
            const unitNum = topics[3].replace(/power/g, 'switch');
            this.serverLightCommand(unitNum, value, CONFIG.server_type);
        } else if (topics[1] == 'elevator' && CONFIG.server_type == 'v2') {
            this.serverEvCommand(value);
        } else {
            const [device, roomIdx, propertyName] = topics.slice(1, 4);
            this.setCommandProperty(device, roomIdx, propertyName, value);
        }
    }

    mqttClientUpdate(device, roomIdx, propertyName, propertyValue) {
        if (!this._deviceReady) {
            return;
        }
        const prefix = CONFIG.mqtt.prefix;
        const topic = `${prefix}/${device}/${roomIdx}/${propertyName}/state`;

        if (typeof propertyValue !== 'number') {
            log.info(`publish to mqtt: ${topic} = ${propertyValue}`);
        }
        this._mqttClient.publish(topic, String(propertyValue), { retain: true });
    }

    mqttDiscovery(device, roomIdx, Idx, prefix) {
        switch (device) {
            case 'light':
                var topic = `homeassistant/light/bestin_wallpad/light_${roomIdx}_${Idx}/config`;
                var payload = {
                    name: `bestin_light_${roomIdx}_${Idx}`,
                    cmd_t: `${prefix}/light/${roomIdx}/${Idx}/command`,
                    stat_t: `${prefix}/light/${roomIdx}/${Idx}/state`,
                    uniq_id: `bestin_light_${roomIdx}_${Idx}`,
                    pl_on: "on",
                    pl_off: "off",
                    device: {
                        ids: "bestin_wallpad",
                        name: "bestin_wallpad",
                        mf: "HDC BESTIN",
                        mdl: "HDC BESTIN Wallpad",
                        sw: "harwin1/ha-addons/bestin_wallpad",
                    }
                }
                break;
            case 'outlet':
                let component = Idx.includes("usage") ? "sensor" : "switch";
                var topic = `homeassistant/${component}/bestin_wallpad/outlet_${roomIdx}_${Idx}/config`;
                var payload = {
                    name: `bestin_outlet_${roomIdx}_${Idx}`,
                    cmd_t: `${prefix}/outlet/${roomIdx}/${Idx}/command`,
                    stat_t: `${prefix}/outlet/${roomIdx}/${Idx}/state`,
                    uniq_id: `bestin_outlet_${roomIdx}_${Idx}`,
                    pl_on: "on",
                    pl_off: "off",
                    ic: Idx.includes("usage") ? "mdi:lightning-bolt" : "mdi:power-socket-eu",
                    unit_of_meas: Idx.includes("usage") ? "Wh" : "",
                    device: {
                        ids: "bestin_wallpad",
                        name: "bestin_wallpad",
                        mf: "HDC BESTIN",
                        mdl: "HDC BESTIN Wallpad",
                        sw: "harwin1/ha-addons/bestin_wallpad",
                    }
                }
                break;
            case 'thermostat':
                var topic = `homeassistant/climate/bestin_wallpad/thermostat_${roomIdx}/config`;
                var payload = {
                    name: `bestin_thermostat_${roomIdx}`,
                    mode_cmd_t: `${prefix}/thermostat/${roomIdx}/power/command`,
                    mode_stat_t: `${prefix}/thermostat/${roomIdx}/power/state`,
                    temp_cmd_t: `${prefix}/thermostat/${roomIdx}/setting/command`,
                    temp_stat_t: `${prefix}/thermostat/${roomIdx}/setting/state`,
                    curr_temp_t: `${prefix}/thermostat/${roomIdx}/current/state`,
                    uniq_id: `bestin_thermostat_${roomIdx}`,
                    modes: ["off", "heat"],
                    min_temp: 5,
                    max_temp: 40,
                    temp_step: 0.1,
                    device: {
                        ids: "bestin_wallpad",
                        name: "bestin_wallpad",
                        mf: "HDC BESTIN",
                        mdl: "HDC BESTIN Wallpad",
                        sw: "harwin1/ha-addons/bestin_wallpad",
                    }
                }
                break;
            case 'ventil':
                var topic = `homeassistant/fan/bestin_wallpad/ventil_${roomIdx}/config`;
                var payload = {
                    name: `bestin_ventil_${roomIdx}`,
                    cmd_t: `${prefix}/ventil/${roomIdx}/power/command`,
                    stat_t: `${prefix}/ventil/${roomIdx}/power/state`,
                    pr_mode_cmd_t: `${prefix}/ventil/${roomIdx}/preset/command`,
                    pr_mode_stat_t: `${prefix}/ventil/${roomIdx}/preset/state`,
                    pr_modes: ["low", "medium", "high"],
                    uniq_id: `bestin_vnetil_${roomIdx}`,
                    pl_on: "on",
                    pl_off: "off",
                    device: {
                        ids: "bestin_wallpad",
                        name: "bestin_wallpad",
                        mf: "HDC BESTIN",
                        mdl: "HDC BESTIN Wallpad",
                        sw: "harwin1/ha-addons/bestin_wallpad",
                    }
                }
                break;
            case 'gas':
                var topic = `homeassistant/switch/bestin_wallpad/gas_valve_${roomIdx}/config`;
                var payload = {
                    name: `bestin_gas_valve_${roomIdx}`,
                    cmd_t: `${prefix}/gas/${roomIdx}/power/command`,
                    stat_t: `${prefix}/gas/${roomIdx}/power/state`,
                    uniq_id: `bestin_gas_valve_${roomIdx}`,
                    pl_on: "on", // 열림은 지원하지 않음
                    pl_off: "off",
                    ic: "mdi:gas-cylinder",
                    device: {
                        ids: "bestin_wallpad",
                        name: "bestin_wallpad",
                        mf: "HDC BESTIN",
                        mdl: "HDC BESTIN Wallpad",
                        sw: "harwin1/ha-addons/bestin_wallpad",
                    }
                }
                break;
            case 'energy':
                var topic = `homeassistant/sensor/bestin_wallpad/energy_${roomIdx}_${Idx}/config`;
                var payload = {
                    name: `bestin_energy_${roomIdx}_${Idx}_usage`,
                    stat_t: `${prefix}/energy/${roomIdx}/${Idx}/state`,
                    unit_of_meas: roomIdx == "elec" ? "kWh" : "m³",
                    uniq_id: `bestin_energy_${roomIdx}_${Idx}_usage`,
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
                var topic = `homeassistant/switch/bestin_wallpad/elevator_${roomIdx}/config`;
                var payload = {
                    name: `bestin_elevator_${roomIdx}`,
                    cmd_t: `${prefix}/elevator/${roomIdx}/call/command`,
                    stat_t: `${prefix}/elevator/${roomIdx}/call/state`,
                    uniq_id: `bestin_elevator_${roomIdx}`,
                    pl_on: "on",
                    pl_off: "off",
                    ic: "mdi:elevator",
                    device: {
                        ids: "bestin_wallpad",
                        name: "bestin_wallpad",
                        mf: "HDC BESTIN",
                        mdl: "HDC BESTIN Wallpad",
                        sw: "harwin1/ha-addons/bestin_wallpad",
                    }
                }
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
        log.info(`initializing ${options.type} :: ${name}...`);
        if (options.type == 'serial') {
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
                log.info(`successfully opened ${name} port: ${options.path}`);
            });
            this._connection.on('close', () => {
                log.warn(`closed ${name} port: ${options.path}`);
            });
            this._connection.open((err) => {
                if (err) {
                    log.error(`failed to open ${name} port: ${err.message}`);
                }
            });
        } else if (options.type == 'socket') {
            this._connection = new net.Socket();
            this._connection.connect(options.port, options.address, () => {
                log.info(`successfully connected to ${name}  [${options.address}:${options.port}]`);
            });
            this._connection.on('error', (err) => {
                if (err.code == 'ETIMEDOUT') {
                    log.error(`${name} connection error occurred process.exit`);
                    setTimeout(() => process.exit(1), 0);
                } else {
                    log.error(`connection error ${err.code}::${name.toUpperCase()}. try to reconnect...`);
                    this._connection.connect(options.port, options.address);
                }
            });
            this._connection.pipe(new CustomParser()).on('data', this.packetHandle.bind(this));
        }
        return this._connection;
    }

    packetHandle(packet) {
        this._lastReceive = new Date();
        if (packet[0] == 0x02 && packet[1] !== 0x41) {
            this._syncTime = this._lastReceive;
            this._timestamp = packet[4];
        }

        const receivedMsg = this._receivedMsgs.find(e => e.codeHex.equals(packet)) || {
            code: packet.toString('hex'),
            codeHex: packet,
            count: 0,
            info: MSG_INFO.filter(e => {
                if (e.length == 10) {
                    const header = parseInt(packet.subarray(0, 3).toString('hex'), 16);
                    return e.header == header;
                } else {
                    const header = parseInt(packet.subarray(0, 4).toString('hex'), 16);
                    return e.header == header && e.length == packet[2];
                }
            }),
        };
        receivedMsg.checksum = this.verifyCheckSum(packet);
        receivedMsg.count++;
        receivedMsg.lastlastReceive = receivedMsg.lastReceive;
        receivedMsg.lastReceive = this._lastReceive;
        receivedMsg.timeslot = this._lastReceive - this._syncTime;

        if (!receivedMsg.checksum) {
            log.error(`checksum error: ${receivedMsg.code}, ${this.generateCheckSum(receivedMsg.codeHex)}`);
            return;
        }

        const byte2 = [0x81, 0x82, 0x83];
        const byte3 = [0x81, 0x92];
        const foundIdx = this._serialCmdQueue.findIndex(e => e.cmdHex[1] == packet[1] && (byte2.includes(packet[2]) || byte3.includes(packet[3])));
        if (foundIdx > -1) {
            log.info(`success command: ${this._serialCmdQueue[foundIdx].device}`);
            const { callback, device } = this._serialCmdQueue[foundIdx];
            if (callback) callback(receivedMsg);
            this._serialCmdQueue.splice(foundIdx, 1);
        }

        for (const msgInfo of receivedMsg.info) {
            if (msgInfo.parseToProperty) {
                const propArray = msgInfo.parseToProperty(packet);
                for (const { device, roomIdx, propertyName, propertyValue } of propArray) {
                    this.updateProperty(device, roomIdx, propertyName, propertyValue, foundIdx > -1);
                }
            }
        }
    }

    addCommandToQueue(cmdHex, device, roomIdx, propertyName, propertyValue, callback) {
        const serialCmd = {
            cmdHex,
            device,
            roomIdx,
            property: propertyName,
            value: propertyValue,
            callback,
            sentTime: new Date(),
            retryCount: CONFIG.rs485.retry_count
        };

        this._serialCmdQueue.push(serialCmd);
        log.info(`send to device: ${cmdHex.toString('hex')}`);

        const elapsed = serialCmd.sentTime - this._syncTime;
        const delay = (elapsed < 100) ? 100 - elapsed : 0;

        setTimeout(() => this.processCommand(serialCmd), delay);
    }

    processCommand(serialCmd) {
        if (this._serialCmdQueue.length == 0) {
            return;
        }
        serialCmd = this._serialCmdQueue.shift();

        const writeHandle = {
            light: this._connEnergy,
            outlet: this._connEnergy,
            ventil: this._connControl,
            gas: this._connControl,
            thermostat: this._connControl
        }[serialCmd.device];

        if (!writeHandle) {
            log.error(`invalid device: ${serialCmd.device}`);
            return;
        }

        writeHandle.write(serialCmd.cmdHex, (err) => {
            if (err) {
                log.error('send Error:', err.message);
            }
        });

        if (serialCmd.retryCount > 0) {
            serialCmd.retryCount--;
            this._serialCmdQueue.push(serialCmd);
            setTimeout(() => this.processCommand(serialCmd), CONFIG.rs485.retry_delay);
        } else {
            log.error(`maximum retries ${CONFIG.rs485.retry_count} times exceeded for command`);
            if (serialCmd.callback) {
                serialCmd.callback.call(this);
            }
        }
    }

    putStatusProperty(device, roomIdx, property) {
        var deviceStatus = {
            device: device,
            roomIdx: roomIdx,
            property: (property ? property : {})
        };
        this._deviceStatus.push(deviceStatus);
        return deviceStatus;
    }

    onlyOffDevice(device) {
        const devices = {
            gas: [0x02, 0x31, 0x02, 0x3C, 0x00, 0x00, 0x00, 0x00, 0x00, 0x11],
            lightbreak: [0x02, 0x31, 0x0B, 0x02, 0x31, 0x3F, 0x00, 0x00, 0x00, 0x00, 0x51]
        };
        return Buffer.from(devices[device]) || null;
    }

    setCommandProperty(device, roomIdx, propertyName, propertyValue, callback) {
        const off = ['gas', 'lightbreak'];
        const msgInfo = MSG_INFO.find(e => e.setPropertyToMsg && (device === e.device || off.includes(device)));

        if (!msgInfo) {
            log.warn(`unknown device: ${device}`);
            return;
        }
        if (off.includes(device) && propertyValue == 'on') {
            log.warn(`unknown command: ${propertyValue}`)
            return;
        }

        const cmdLength = msgInfo.length === 10 ? 3 : 4;
        const cmdHex = Buffer.alloc(msgInfo.length);
        cmdHex.writeUIntBE(msgInfo.header, 0, cmdLength);
        msgInfo.setPropertyToMsg(cmdHex, roomIdx, propertyName, propertyValue);
        cmdHex[msgInfo.length - 1] = this.generateCheckSum(cmdHex);

        const buffer = off.includes(device) ? this.onlyOffDevice(device) : cmdHex;
        this.addCommandToQueue(buffer, device, roomIdx, propertyName, propertyValue, callback);
    }

    updateProperty(device, roomIdx, propertyName, propertyValue, force) {
        const propertyKey = device + roomIdx + propertyName;
        const isSamePropertyValue = !force && this._deviceStatusCache[propertyKey] === propertyValue;
        if (isSamePropertyValue) return;

        this._deviceStatusCache[propertyKey] = propertyValue;

        let deviceStatus = this._deviceStatus.find(o => o.device === device && o.roomIdx === roomIdx);
        if (!deviceStatus) {
            deviceStatus = this.putStatusProperty(device, roomIdx);
        }
        deviceStatus.property[propertyName] = propertyValue;

        this.mqttClientUpdate(device, roomIdx, propertyName, propertyValue);

        const discoveryOn = setImmediate(() => {
            if (!this._discovery && CONFIG.mqtt.discovery) {
                this.mqttDiscovery(device, roomIdx, propertyName, CONFIG.mqtt.prefix);
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
                log.error(`ipark v1 server login failed with error code: ${error}`);
                return;
            }

            const parse = JSON.parse(body);
            if (response.statusCode === 200 && parse.ret === 'success') {
                log.info('ipark v1 server login successful');
                this.loginManagement(response, 'v1');
            } else {
                log.warn(`ipark v1 server login failed: ${parse.ret}`);
            }
        });
    }

    serverLogin2() {
        request.post(V2LOGIN, (error, response, body) => {
            if (error) {
                log.error(`ipark v2 server login failed with error code: ${error}`);
                return;
            }

            const parse = JSON.parse(body);
            if (response.statusCode === 200) {
                log.info('ipark v2 server login successful');
                this.loginManagement(parse, 'v2');
            } else {
                log.error(`ipark v2 server error statusCode: ${response.statusCode}`);
            }
        });
    }

    sf(obj, ...args) {
        Object.keys(obj).forEach(key => {
            const val = obj[key];
            if (typeof val === 'object') {
                this.sf(val, ...args);
            } else if (typeof val === 'string') {
                obj[key] = val.replace(/\{(\d+)\}/g, (match, p1) => args[p1]);
            }
        });
        return obj;
    }

    loginManagement(res, type) {
        const sf = this.sf.bind(this);

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
                log.error('unable to assign parsed login cookie information to cookieInfo from server');
                return;
            }
            return cookieJson;
        }
        if (isV1) var cookieJson = cookie();

        this._loginInfo = (isV1 ? cookieJson : res);
        sf(isV1 ? V1LIGHTSTATUS : V2LIGHTSTATUS, isV1 ? cookieJson.phpsessid : res.url, isV1 ? cookieJson.userid : res['access-token'], isV1 ? cookieJson.username : null);

        const statusUrl = isV1 ? V1LIGHTSTATUS : V2LIGHTSTATUS;
        const lightStatFunc = this.getServerLightStatus.bind(this);
        lightStatFunc(statusUrl, type);
        setInterval(lightStatFunc, CONFIG.server_scan * 1000);

        if (!isV1) {
            this.getServerElevatorStatus(V2HDCLOGIN, V2EVSTATUS);
        }
    }

    getServerLightStatus(url, type) {
        request.get(url, (error, response, body) => {
            if (error) {
                log.error(`failed to retrieve server light status: ${error}`);
                return;
            }

            if (response.statusCode !== 200) {
                log.error(`failed to retrieve server light status: status code ${response.statusCode}`);
                return;
            }

            log.info('server light status request successful!');

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
                log.error(`Failed to parse XML light status: ${err}`);
                return;
            }

            const statusInfo = result?.imap?.service?.[0]?.status_info;

            if (!statusInfo) {
                log.warn('Failed to parse XML light status: status_info property not found');
                return;
            }

            statusInfo.forEach(status => {
                const device = 'light';
                const roomIdx = 'livingroom';
                const unitNum = status.$.unit_num.replace(/switch/g, 'power');
                const unitStatus = status.$.unit_status;

                this.updateProperty(device, roomIdx, unitNum, unitStatus);
            });
        });
    }

    parseJsonLightStatus(json) {
        let data;

        try {
            data = JSON.parse(json);
        } catch (err) {
            log.error(`failed to parse JSON light status: ${err}`);
            return;
        }

        const units = data?.units;

        if (!units) {
            log.warn('failed to parse JSON light status: units property not found');
            return;
        }

        units.forEach((unit) => {
            const device = 'light';
            const roomIdx = 'livingroom';
            const unitNum = unit.unit.replace(/switch/g, 'power');

            this.updateProperty(device, roomIdx, unitNum, unit.state);
        });
    }

    getServerElevatorStatus(loginUrl) {
        request.post(loginUrl, (error, response, body) => {
            if (error) {
                log.error(`failed to retrieve hdc manager server status: ${error}`);
                return;
            }

            if (response.statusCode !== 200) {
                log.warn(`failed to retrieve hdc manager server status: status code ${response.statusCode}`);
                return;
            }

            log.info('hdc manager server request successful!');
            const device = 'elevator';
            const roomIdx = '1';

            this.updateProperty(device, roomIdx, 'call', 'off');
        });
        /////////////////


    }

    serverLightCommand(unit, state, type) {
        if (type === 'v1') {
            var url = this.sf(V1LIGHTCMD, this._loginInfo.phpsessid, this._loginInfo.userid, this._login.username, unit, state);
        } else {
            var url2 = this.sf(V2LIGHTCMD, this._loginInfo.url, unit.slice(-1), unit, state, this._loginInfo['access-token']);
        }
        request(type == 'v1' ? url : url2, (error, response) => {
            if (error) {
                log.error(`failed to retrieve server light command: ${error}`);
                return;
            }

            if (response.statusCode !== 200) {
                log.error(`failed to retrieve server light command: status code ${response.statusCode}`);
                return;
            }
            log.info('server livinglight command request successful!');
            const device = 'light';
            const roomIdx = 'livingroom';

            this.updateProperty(device, roomIdx, unit.replace(/switch/g, 'power'), state);
        });
    }

    serverEvCommand(state) {
        const url = this.sf(V2ELEVATORCMD, this._loginInfo.url);
        request(url, (error, response) => {
            if (error) {
                log.error(`failed to retrieve server elevator command: ${error}`);
                return;
            }

            if (response.statusCode !== 200) {
                log.error(`failed to retrieve server elevator command: status code ${response.statusCode}`);
                return;
            }
            log.info('server elevator command request successful!');
            const device = 'elevator';
            const roomIdx = '1';

            this.updateProperty(device, roomIdx, 'call', state);
        });
    }

}
new rs485();