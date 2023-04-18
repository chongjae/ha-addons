/** 
 * @description bestin_wallpad.js
 * @author harwin1
 */

const fs = require('fs'); 
const net = require('net');
const SerialPort = require('serialport').SerialPort;
const mqtt = require('mqtt');
const request = require('request');
const xml2js = require('xml2js');

// 커스텀 파서
const log = require('simple-node-logger').createSimpleLogger();
const Transform = require('stream').Transform;
const CONFIG = require('./config.json').options;
const {
    V1LOGIN, V2LOGIN, V1LIST, V2LIST, LIGHTSTATUS, LIGHTCMD, VENTEMPSTR, VENTEMPINT
} = require('./server.js').default;

const MSG_INFO = [
    ///////////////////////
    //command <-> response
    { device: 'light', header: 0x02310D01, length: 13, request: 'set', 
            setPropertyToMsg: (b, i, n, v) => {
                let id = n.slice(-1) - 1, pos = (v == 'on' ? 0x80 : 0x00), onff = (v == 'on' ? 0x04 : 0x00);

                b[5] = i & 0x0F;
                if (n == 'batch') b[6] = (v == 'on' ? 0x8F : 0x0F)
                else b[6] = (0x01 << id | pos);
                b[11] = onff;

                return b;
            }
    },
    { device: 'outlet', header: 0x02310D01, length: 13, request: 'set',
            setPropertyToMsg: (b, i, n, v) => {
                let id = n.slice(-1) - 1, pos = (v == 'on' ? 0x80 : 0x00), onff = (v == 'on' ? 0x09 << id : 0x00);

                b[5] = i & 0x0F;
                if (n == 'standby') b[8] = (v == 'on' ? 0x83 : 0x03)
                else if (n == 'batch') b[7] = (v == 'on' ? 0x8F : 0x0F), b[11] = onff
                else b[7] = (0x01 << id | pos), b[11] = onff;

                return b;
            }
    },


    { device: 'thermostat', header: 0x02280E12, length: 14, request: 'set',
            setPropertyToMsg: (b, i, n, v) => {
                let power = (v == 'heat' ? 0x01 : 0x02), val = parseFloat(v), vInt = parseInt(val), vFloat = val - vInt;

                b[5] = i & 0x0F;
                if (n == 'power') b[6] = power
                else b[7] = ((vInt & 0xFF) | ((vFloat != 0) ? 0x40 : 0x00));

                return b;
            }
    },
    { device: 'ventil', header: 0x026100, length: 10, request: 'set',
            setPropertyToMsg: (b, i, n, v) => {
                if (n == 'power') b[2] = 0x01, b[5] = (v == 'on' ? 0x01 : 0x00), b[6] = 0x01
                else b[2] = 0x03, b[6] = VENTEMPSTR[v];

                return b;
            }
    },
    { device: 'gas', header: 0x023102, length: 10, request: 'set',
            setPropertyToMsg: (b, i, n, v) => {
                
                return b;
            }
    },

    /////////////////////
    //query <-> response
    { device: 'light', header: 0x02311E91, length: 30, request: 'ack',
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
    { device: 'outlet', header: 0x02311E91, length: 30, request: 'ack',
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

    { device: 'thermostat', header: 0x02281091, length: 16, request: 'ack',
            parseToProperty: (b) => {
                const propArr = [], roomIdx = b[5] & 0x0F;

                propArr.push(
                ...[{ propertyName: 'power', propertyValue: (b[7] & (1 << i)) ? 'on' : 'off' },
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
    { device: 'ventil', header: 0x026180, length: 10, request: 'ack',
            parseToProperty: (b) => {
                return [
                    { device: 'ventil', roomIdx: 1, propertyName: 'power', propertyValue: (b[5] ? 'on' : 'off') },
                    { device: 'ventil', roomIdx: 1, propertyName: 'preset', propertyValue: VENTEMPINT[b[6]] },
                ];
        }
    },
    { device: 'gas', header: 0x023180, length: 10, request: 'ack',
            parseToProperty: (b) => {
                return [{ device: 'gas', roomIdx: 1, propertyName: 'power', propertyValue: (b[5] ? 'on' : 'off') }];
        }
    },


    { device: 'energy', header: 0x02D13082, length: 48, request: 'ack',
            parseToProperty: (b) => {
                const propArr = [], idx = 13; 

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

        this._mqttClient = this.mqttClient();
        this._connEnergy = this.createConnection(CONFIG.energy_port, 'energy');
        this._connControl = this.createConnection(CONFIG.control_port, 'control');
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
        if (topics[0] !== 'bestin') {
            return;
        }

        if (topics[2] == 'living') {
            const unitNum = topics[3].replace(/power/g, 'switch');
            this.lightCmdOptions(unitNum, value);
        } else {
            const [device, roomIdx, propertyName] = topics.slice(1, 4);
            this.setCommandProperty(device, roomIdx, propertyName, value);
        }
    }

    mqttClientUpdate(device, roomIdx, propertyName, propertyValue) {
        if (!this._deviceReady) {
            return;
        }
        const topic = `${this._mqttPrefix}/${device}/${roomIdx}/${propertyName}/state`;

        if (typeof (propertyValue) !== 'number') {
            log.info(`publish to mqtt: ${topic} = ${propertyValue}`);
        }
        this._mqttClient.publish(topic, String(propertyValue), { retain: true });
    }

    mqttDiscovery(device, roomIdx, Idx) {
        switch (device) {
            case 'light':
                var topic = `homeassistant/light/bestin_wallpad/light_${roomIdx}_${Idx}/config`;
                var payload = {
                    name: `bestin_light_${roomIdx}_${Idx}`,
                    cmd_t: `${this._mqttPrefix}/light/${roomIdx}/${Idx}/command`,
                    stat_t: `${this._mqttPrefix}/light/${roomIdx}/${Idx}/state`,
                    uniq_id: `bestin_light_${roomIdx}_${Idx}`,
                    pl_on: "on",
                    pl_off: "off",
                    device: {
                        ids: "bestin_wallpad",
                        name: "bestin_wallpad",
                        mf: "HDC BESTIN",
                        mdl: "HDC BESTIN Wallpad",
                        sw: "harwin1/bestin-v1/bestin_wallpad",
                    }
                }
                break;
            case 'outlet':
                let component = Idx.includes("usage") ? "sensor" : "switch";
                var topic = `homeassistant/${component}/bestin_wallpad/outlet_${roomIdx}_${Idx}/config`;
                var payload = {
                    name: `bestin_outlet_${roomIdx}_${Idx}`,
                    cmd_t: `${this._mqttPrefix}/outlet/${roomIdx}/${Idx}/command`,
                    stat_t: `${this._mqttPrefix}/outlet/${roomIdx}/${Idx}/state`,
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
                        sw: "harwin1/bestin-v1/bestin_wallpad",
                    }
                }
                break;
            case 'thermostat':
                var topic = `homeassistant/climate/bestin_wallpad/thermostat_${roomIdx}/config`;
                var payload = {
                    name: `bestin_thermostat_${roomIdx}`,
                    mode_cmd_t: `${this._mqttPrefix}/thermostat/${roomIdx}/mode/command`,
                    mode_stat_t: `${this._mqttPrefix}/thermostat/${roomIdx}/mode/state`,
                    temp_cmd_t: `${this._mqttPrefix}/thermostat/${roomIdx}/setting/command`,
                    temp_stat_t: `${this._mqttPrefix}/thermostat/${roomIdx}/setting/state`,
                    curr_temp_t: `${this._mqttPrefix}/thermostat/${roomIdx}/current/state`,
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
                        sw: "harwin1/bestin-v1/bestin_wallpad",
                    }
                }
                break;
            case 'ventil':
                var topic = `homeassistant/fan/bestin_wallpad/ventil_${roomIdx}/config`;
                var payload = {
                    name: `bestin_ventil_${roomIdx}`,
                    cmd_t: `${this._mqttPrefix}/ventil/${roomIdx}/power/command`,
                    stat_t: `${this._mqttPrefix}/ventil/${roomIdx}/power/state`,
                    pr_mode_cmd_t: `${this._mqttPrefix}/ventil/${roomIdx}/preset/command`,
                    pr_mode_stat_t: `${this._mqttPrefix}/ventil/${roomIdx}/preset/state`,
                    pr_modes: ["01", "02", "03"],
                    uniq_id: `bestin_vnetil_${roomIdx}`,
                    pl_on: "on",
                    pl_off: "off",
                    device: {
                        ids: "bestin_wallpad",
                        name: "bestin_wallpad",
                        mf: "HDC BESTIN",
                        mdl: "HDC BESTIN Wallpad",
                        sw: "harwin1/bestin-v1/bestin_wallpad",
                    }
                }
                break;
            case 'gas':
                var topic = `homeassistant/switch/bestin_wallpad/gas_valve_${roomIdx}/config`;
                var payload = {
                    name: `bestin_gas_valve_${roomIdx}`,
                    cmd_t: `${this._mqttPrefix}/gas/${roomIdx}/power/command`,
                    stat_t: `${this._mqttPrefix}/gas/${roomIdx}/power/state`,
                    uniq_id: `bestin_gas_valve_${roomIdx}`,
                    pl_on: "on",
                    pl_off: "off",
                    ic: "mdi:gas-cylinder",
                    device: {
                        ids: "bestin_wallpad",
                        name: "bestin_wallpad",
                        mf: "HDC BESTIN",
                        mdl: "HDC BESTIN Wallpad",
                        sw: "harwin1/bestin-v1/bestin_wallpad",
                    }
                }
                break;
            case 'energy':
                var topic = `homeassistant/sensor/bestin_wallpad/energy_${roomIdx}_${Idx}/config`;
                var payload = {
                    name: `bestin_energy_${roomIdx}_${Idx}_usage`,
                    stat_t: `${this._mqttPrefix}/energy/${roomIdx}/${Idx}/state`,
                    unit_of_meas: roomIdx == "elec" ? "kWh" : "m³",
                    uniq_id: `bestin_energy_${roomIdx}_${Idx}_usage`,
                    device: {
                        ids: "bestin_wallpad",
                        name: "bestin_wallpad",
                        mf: "HDC BESTIN",
                        mdl: "HDC BESTIN Wallpad",
                        sw: "harwin1/bestin-v1/bestin_wallpad",
                    },
                };
                break;
            case 'vehicle':
                var topic = `homeassistant/sensor/bestin_wallpad/vehicle_${roomIdx}/config`;
                var payload = {
                    name: `bestin_vehicle_${roomIdx}`,
                    stat_t: `${this._mqttPrefix}/vehicle/${roomIdx}/info/state`,
                    uniq_id: `bestin_vehicle_${roomIdx}`,
                    ic: "mdi:car",
                    device: {
                        ids: "bestin_wallpad",
                        name: "bestin_wallpad",
                        mf: "HDC BESTIN",
                        mdl: "HDC BESTIN Wallpad",
                        sw: "harwin1/bestin-v1/bestin_wallpad",
                    }
                }
                break;
            case 'delivery':
                var topic = `homeassistant/sensor/bestin_wallpad/delivery_${roomIdx}/config`;
                var payload = {
                    name: `bestin_delivery_${roomIdx}`,
                    stat_t: `${this._mqttPrefix}/delivery/${roomIdx}/info/state`,
                    uniq_id: `bestin_delivery_${roomIdx}`,
                    ic: "mdi:archive-check",
                    device: {
                        ids: "bestin_wallpad",
                        name: "bestin_wallpad",
                        mf: "HDC BESTIN",
                        mdl: "HDC BESTIN Wallpad",
                        sw: "harwin1/bestin-v1/bestin_wallpad",
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
                path: options.ser_path,
                baudRate: 9600,
                dataBits: 8,
                parity: 'none',
                stopBits: 1,
                autoOpen: false,
                encoding: 'hex'
            });

            this._connection.pipe(new CustomParser()).on('data', this.packetHandle.bind(this));
            this._connection.on('open', () => {
                log.info(`successfully opened ${name} port: ${options.ser_path}`);
            });
            this._connection.on('close', () => {
                log.warn(`closed ${name} port: ${options.ser_path}`);
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
                    //setTimeout(() => process.exit(1), 0);
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

        const BYTE2 = [0x81, 0x82, 0x83];
        const BYTE3 = [0x81, 0x92];
        const foundIdx = this._serialCmdQueue.findIndex(e => e.cmdHex[1] == packet[1] && (BYTE2.includes(packet[2]) || BYTE3.includes(packet[3])));
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
            log.error(`Invalid device: ${serialCmd.device}`);
            return;
        }

        writeHandle.write(serialCmd.cmdHex, (err) => {
            if (err) {
                log.error('Send Error:', err.message);
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

    setCommandProperty(device, roomIdx, propertyName, propertyValue, callback) {
        log.info(`recv. from HA: ${this._mqttPrefix}/${device}/${roomIdx}/${propertyName}/command = ${propertyValue}`);

        const msgInfo = MSG_INFO.find(e => e.setPropertyToMsg && e.device === device);
        if (!msgInfo) {
            log.warn(`unknown device: ${device}`);
            return;
        }
        if (msgInfo.device == 'gas' && propertyValue == 'on') {
            log.warn('The gas valve only supports locking');
            return;
        }

        const cmdHex = Buffer.alloc(msgInfo.length);
        msgInfo.length == 10 ? cmdHex.writeUIntBE(msgInfo.header, 0, 3) : cmdHex.writeUIntBE(msgInfo.header, 0, 4)
        msgInfo.setPropertyToMsg(cmdHex, roomIdx, propertyName, propertyValue);
        cmdHex[msgInfo.length - 1] = this.generateCheckSum(cmdHex);

        this.addCommandToQueue(cmdHex, device, roomIdx, propertyName, propertyValue, callback);
        //this.updateProperty(device, roomIdx, propertyName, propertyValue);
    }

    updateProperty(device, roomIdx, propertyName, propertyValue, force) {
        const propertyKey = device + roomIdx + propertyName;
        const isSamePropertyValue = !force && this._deviceStatusCache[propertyKey] === propertyValue;
        if (isSamePropertyValue) return;

        const isPendingCommand = this._serialCmdQueue.some(e => e.device === device && e.roomIdx === roomIdx && e.property === propertyName && e.value === this._deviceStatusCache[propertyKey]);
        if (isPendingCommand) return;

        this._deviceStatusCache[propertyKey] = propertyValue;

        let deviceStatus = this._deviceStatus.find(o => o.device === device && o.roomIdx === roomIdx);
        if (!deviceStatus) {
            deviceStatus = this.putStatusProperty(device, roomIdx);
        }
        deviceStatus.property[propertyName] = propertyValue;

        this.mqttClientUpdate(device, roomIdx, propertyName, propertyValue);

        let discoveryOn = false;
        if (CONFIG.mqtt.discovery && !discoveryOn) {
            this.mqttDiscovery(device, roomIdx, propertyName);
            setTimeout(() => { discoveryOn = true }, 10000);
        }
    }

    serverCreate(able, type) {
        const { address, username, password, uuid } = CONFIG.server;
        if (able && type == 'v1') {
            this.serverLogin(address, username, password);
            setInterval(() => this.serverLogin(address, username, password), 1200000);
        }
        else if (able && type == 'v2') {
            this.serverLogin2(uuid);
            setInterval(() => this.serverLogin2(uuid), 3600000);
        }
    }

    serverLogin(addr, user, pass) {
        request.get(serverV1Login
            .replace('{}', addr)
            .replace('{}', user)
            .replace('{}', pass), (error, response, body) => {
                if (error) {
                    log.error(`I-PARK v1 server login failed with error code: ${error}`);
                    return;
                }

                const parse = JSON.parse(body);
                if (response.statusCode === 200 && parse.ret === 'success') {
                    log.info('I-PARK v1 server login successful');
                    this.cookieInfo(response);
                } else {
                    log.warn(`I-PARK v1 server login failed: ${parse.ret}`);
                }
            });
    }

    cookieInfo(res) {
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

        this.loginInfoFile(cookieJson);
    }

    serverLogin2(uuid) {
        const j = JSON.stringify(serverV2Login).replace('{}', uuid);
        request.post(JSON.parse(j), (error, response, body) => {
            if (error) {
                log.error(`I-PARK v2 server login failed with error code: ${error}`);
                return;
            }

            const parse = JSON.parse(body);
            if (response.statusCode === 200) {
                log.info('I-PARK v2 server login successful');
                this.loginInfoFile(parse);
            } else {
                log.warn(`I-PARK v2 server login failed: ${response.statusCode}`);
            }
        });
    }

    loginInfoFile(attr) {
        const json = JSON.stringify(attr);

        if (Object.keys(attr).length == 3) {
            fs.writeFile('./apiv1.json', json, (err) => {
                if (err) {
                    log.error(`file write error: ${err}`);
                    return;
                }
                log.info('The apiv1 file has been saved!');
            });
        } else if (Object.keys(attr).length == 7) {
            fs.writeFile('./apiv2.json', json, (err) => {
                if (err) {
                    log.error(`file write error: ${err}`);
                    return;
                }
                log.info('The apiv2 file has been saved!');
            });
        }
    }


}

new rs485();
