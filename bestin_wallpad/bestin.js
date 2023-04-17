/** 
 * @description bestin.js
 * @author harwin1
 */

//const fs = require('fs');
const net = require('net');
const SerialPort = require('serialport').SerialPort;
const mqtt = require('mqtt');
const request = require('request');
const xml2js = require('xml2js');

// 커스텀 파서
const log = require('simple-node-logger').createSimpleLogger();
const Transform = require('stream').Transform;
const CONFIG = require('/data/options.json');


const MSG_INFO = [
    /////////////////////////////////////////////////////////////////////////////
    //command <-> response
    {
        device: 'light', header: 0x02310D01, length: 13, request: 'set',
        setPropertyToMsg: (b, i, n, v) => {
            let id = (n.replace(/[^0-9]/g, "") - 1), val = (v == 'on' ? 0x80 : 0x00), on = (v == 'on' ? 0x04 : 0x00);
            b[5] = i & 0x0F;
            if (n.includes('power')) b[6] = (0x01 << id | val), b[11] = on;
            else if (n == 'batch') b[6] = (v == 'on' ? 0x8F : 0x0F), b[11] = on;

            return b;
        }
    },

    {
        device: 'outlet', header: 0x02310D01, length: 13, request: 'set',
        setPropertyToMsg: (b, i, n, v) => {
            let id = (n.replace(/[^0-9]/g, "") - 1), val = (v == 'on' ? 0x80 : 0x00), on = (v == 'on' ? 0x09 << id : 0x00);
            b[5] = i & 0x0F;
            if (n.includes('power')) b[7] = (0x01 << id | val), b[11] = on;
            else if (n == 'standby') b[8] = (v == 'on' ? 0x83 : 0x03);
            else if (n == 'batch') b[7] = (v == 'on' ? 0x8F : 0x0F), b[11] = on;

            return b;
        }
    },

    {
        device: 'thermostat', header: 0x02280E12, length: 14, request: 'set',
        setPropertyToMsg: (b, i, n, v) => {
            b[5] = i & 0x0F;
            mod = (v == 'heat' ? 0x01 : 0x02), val = parseFloat(v), vInt = parseInt(val), vFloat = val - vInt;
            if (n == 'mode') b[6] = mod;
            else if (n == 'setting') b[7] = ((vInt & 0xFF) | ((vFloat != 0) ? 0x40 : 0x00));

            return b;
        }
    },

    {
        device: 'ventil', header: 0x026100, length: 10, request: 'set',
        setPropertyToMsg: (b, i, n, v) => {
            if (n == 'power') b[2] = 0x01, b[5] = (v == 'on' ? 0x01 : 0x00), b[6] = 0x01;
            else if (n == 'preset') b[2] = 0x03, b[6] = Number(v);

            return b;
        }
    },

    {
        device: 'gas', header: 0x023102, length: 10, request: 'set',
        setPropertyToMsg: (b, i, n, v) => {
            return b;
        }
    },

    /////////////////////////////////////////////////////////////////////////////
    //query <-> response
    {
        device: 'light', header: 0x02311E91, length: 30, request: 'ack',
        parseToProperty: (b) => {
            var propArr = []; let m = (b[6].toString(16).slice(0, 1) == 'c' ? 4 : 3);
            let num = (b[5] & 0x0F) == 1 ? m : 2;
            for (let i = 0; i < num; i++) {
                propArr.push({
                    device: 'light', roomIdx: b[5] & 0x0F, propertyName: 'power' + (i + 1),
                    propertyValue: ((b[6] & (1 << i)) ? 'on' : 'off'),
                },
                    {
                        device: 'light', roomIdx: b[5] & 0x0F, propertyName: 'batch',
                        propertyValue: ((b[6] & 0x0F) ? 'on' : 'off'),
                    });
            }
            return propArr;
        }
    },

    {
        device: 'outlet', header: 0x02311E91, length: 30, request: 'ack',
        parseToProperty: (b) => {
            var propArr = []; let num = (b[5] & 0x0F) == 1 ? 3 : 2;
            for (let i = 0; i < num; i++) {
                consumption = b.length > (i1 = 14 + 2 * i) + 2 ? parseInt(b.slice(i1, i1 + 2).toString('hex'), 16) / 10 : 0;
                propArr.push({
                    device: 'outlet', roomIdx: b[5] & 0x0F, propertyName: 'power' + (i + 1),
                    propertyValue: ((b[7] & (1 << i)) ? 'on' : 'off'),
                },
                    {
                        device: 'outlet', roomIdx: b[5] & 0x0F, propertyName: 'usage' + (i + 1),
                        propertyValue: consumption,
                    },
                    {
                        device: 'outlet', roomIdx: b[5] & 0x0F, propertyName: 'standby',
                        propertyValue: ((b[7] >> 4 & 1) ? 'on' : 'off'),
                    },
                    {
                        device: 'outlet', roomIdx: b[5] & 0x0F, propertyName: 'batch',
                        propertyValue: ((b[7] & 0x0F) ? 'on' : 'off'),
                    });
            }
            return propArr;
        }
    },

    {
        device: 'thermostat', header: 0x02281091, length: 16, request: 'ack',
        parseToProperty: (b) => {
            return [
                { device: 'thermostat', roomIdx: b[5] & 0x0F, propertyName: 'mode', propertyValue: (b[6] & 0x01) ? 'heat' : 'off' },
                { device: 'thermostat', roomIdx: b[5] & 0x0F, propertyName: 'setting', propertyValue: (b[7] & 0x3F) + ((b[7] & 0x40) > 0) * 0.5 },
                { device: 'thermostat', roomIdx: b[5] & 0x0F, propertyName: 'current', propertyValue: (b[8] << 8) + b[9] / 10.0 },
            ];
        }
    },

    {
        device: 'ventil', header: 0x026180, length: 10, request: 'ack',
        parseToProperty: (b) => {
            return [
                { device: 'ventil', roomIdx: 1, propertyName: 'power', propertyValue: (b[5] ? 'on' : 'off') },
                { device: 'ventil', roomIdx: 1, propertyName: 'preset', propertyValue: b[6].toString().padStart(2, '0') },
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
            var propArr = [];
            let idx = 13; // 13번째 바이트부터 소비량이 들어있음
            for (let name of ['elec', 'heat', 'hwater', 'gas', 'water']) {
                consumption = Number(b.slice(idx, idx + 2).toString('hex'));
                propArr.push({ device: 'energy', roomIdx: name, propertyName: 'home', propertyValue: consumption });
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
                //console.log(expectedLength);
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
        this._connection = undefined;
        this._timestamp = undefined;
        this._discovery = false;
        this._cookieInfo = {};

        this._mqttClient = this.mqttClient();
        this._mqttPrefix = CONFIG.mqtt.prefix;
        this._connEnergy = this.createConnection(CONFIG.energy_port, 'energy');
        this._connControl = this.createConnection(CONFIG.control_port, 'control');
        this.serverCreate(CONFIG.server_enable, CONFIG.server_type);
    }

    mqttClient() {
        const client = mqtt.connect(`mqtt://${CONFIG.mqtt.broker}`, {
            port: CONFIG.mqtt.port,
            username: CONFIG.mqtt.username,
            password: CONFIG.mqtt.password,
            clientId: 'BESTIN_WALLPAD',
        });

        client.on('connect', () => {
            log.info('MQTT connection successful!');
            this._deviceReady = true; // mqtt 연결 성공하면 장치 준비 완료
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

        // ha에서 mqtt로 제어 명령 수신
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
        if (topics[0] !== this._mqttPrefix) {
            return;
        }

        if (topics[2] == 'living') {
            const unitNum = topics[3].replace(/power/g, 'switch');
            this.serverLightCmd(unitNum, value);
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
        //console.log(typeof (propertyValue));

        if (typeof (propertyValue) !== 'number') {
            log.info(`publish mqtt: ${topic} = ${propertyValue}`);
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
        // 3으로 초기화
        let result = 0x03;
        for (let i = 0; i < packet.length; i++) {
            result ^= packet[i];
            result = (result + 1) & 0xFF;
            // 바이트를 순차적으로 xor 한뒤 +1 / 8비트로 truncation
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
                log.error(`connection error ${err.code}::${name.toUpperCase()}. try to reconnect...`);
                this._connection.connect(options.port, options.address);
                // 연결 애러 발생시 reconnect
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

        if (!Boolean(receivedMsg.checksum)) {
            log.error(`checksum error: ${receivedMsg.code}, ${this.generateCheckSum(receivedMsg.codeHex)}`);
            return;
        }

        const BYTE2 = [0x81, 0x82, 0x83];
        const BYTE3 = [0x81, 0x92];
        const foundIdx = this._serialCmdQueue.findIndex(e => e.cmdHex[1] == packet[1] && (BYTE2.includes(packet[2]) || BYTE3.includes(packet[3])));
        if (foundIdx > -1) {
            log.info(`Success command: ${this._serialCmdQueue[foundIdx].device}`);
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
        this.updateProperty(device, roomIdx, propertyName, propertyValue);
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

        const discoverySet = setTimeout(() => {
            if (CONFIG.mqtt.discovery && !this._discovery) 
                this.mqttDiscovery(device, roomIdx, propertyName); 
                this._discovery = true;
                }, 5000);
        if (this._discovery) clearTimeout(discoverySet)
        

    serverCreate(able, type) {
        if (able) {
            if (type == '1.0') this.serverLogin();
            else (type == '2.0') this.serverLogin2();
        } else {
            log.info(`I-PARK ${type} server disabled`);
        }
    }

    serverLogin() {
        const that = this;
        const login = `http://${CONFIG.ipark_server.address}/webapp/data/getLoginWebApp.php?device=WA&login_ide=${CONFIG.ipark_server.username}&login_pwd=${CONFIG.ipark_server.password}`;
        request.get(login, (error, response, body) => {
            if (error) {
                log.error(`I-PARK 1.0 server login failed with error code: ${error}`);
                return;
            }

            const parse = JSON.parse(body);
            if (response.statusCode === 200 && parse.ret === 'success') {
                    log.info('I-PARK server login successful');
                    that.cookieInfo(response);
            } else {
                log.warn(`I-PARK 1.0 server login failed: ${parse.ret}`);
            }
        });
    }
    
    serverLogin2() {
        const that = this;
        const login = ``;
        request.post(login, (error, response, body) => {
            if (error) {
                log.error(`I-PARK 2.0 server login failed with error code: ${error}`);
                return;
            }

            const parse = JSON.parse(body);
            if (response.statusCode === 200 && parse.ret === 'success') {
                    log.info('I-PARK server login successful');
                    that.cookieInfo(response);
            } else {
                log.warn(`I-PARK 2.0 server login failed: ${parse.ret}`);
            }
        });
    }

    //errorfile(parse) {
    //    if (!fs.existsSync('./sessionInfo.json')) {
    //        fs.writeFileSync('./sessionInfo.json', JSON.stringify(parse), 'utf8');
    //        log('sessionInfo.json saved successfully!');
    //    } else {
    //        log('already sessionInfo.json saved pass..');
    //    }
    //}

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
        this._cookieInfo = cookieJson;

        if (!this._cookieInfo) {
            log.error('unable to assign parsed login cookie information to cookieInfo from server');
            return;
        }



            this.selectServerDevice();
        } else if (type === 'relogin') {
            log.info('successful refresh of session cookie information');
        }
    }

    selectServerDevice() {
        const functionsToCall = [];
        for (const [deviceName, deviceBool] of Object.entries(CONFIG.ipark_server_device)) {
            if (deviceBool === true) {
                switch (deviceName) {
                    case 'living_light':
                        functionsToCall.push(this.IparkLightStatusOptions);
                        break;
                    case 'vehicle':
                        functionsToCall.push(this.IparkVehicleStatusOptions);
                        break;
                    case 'delivery':
                        functionsToCall.push(this.IparkDeliveryStatusOptions);
                        break;
                    case 'energy':
                        functionsToCall.push(this.IparkEnergyStatusOptions);
                        break;
                }
            }
            log.info(`I-Park server selected devices: ${deviceName}::${deviceBool}`);
        }

        functionsToCall.forEach((func) => func.call(this));
        setInterval(() => {
            functionsToCall.forEach((func) => func.call(this)); log.info('Refresh I-Park server device status connection');
        }, CONFIG.server_scan * 1000);
    }

    IparkLightStatusOptions() {
        const options = {
            url: `http://${CONFIG.ipark_server.address}/webapp/data/getHomeDevice.php`,
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Cookie': `PHPSESSID=${this._cookieInfo.phpsessid}; user_id=${this._cookieInfo.userid}; user_name=${this._cookieInfo.username}`,
            },
            qs: {
                req_name: 'remote_access_livinglight',
                req_action: 'status',
            },
        };
        this.IparkServerStatusParse(options, 'light');
    }

    IparkVehicleStatusOptions() {
        const options = {
            url: `http://${CONFIG.ipark_server.address}/webapp/car_parking.php`,
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Cookie': `PHPSESSID=${this._cookieInfo.phpsessid}; user_id=${this._cookieInfo.userid}; user_name=${this._cookieInfo.username}`,
            },
            qs: {
                start: '1', // 시작 위치
                desiredPosts: '0', // 표시할 갯수
            },
        };
        this.IparkServerStatusParse(options, 'vehicle');
    }

    IparkDeliveryStatusOptions() {
        const options = {
            url: `http://${CONFIG.ipark_server.address}/webapp/deliveryList.php`,
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Cookie': `PHPSESSID=${this._cookieInfo.phpsessid}; user_id=${this._cookieInfo.userid}; user_name=${this._cookieInfo.username}`,
            },
            qs: {
                start: '1', // 시작 위치
                desiredPosts: '0', // 표시할 갯수
            },
        };
        this.IparkServerStatusParse(options, 'delivery');
    }

    IparkEnergyStatusOptions() {
        const day = new Date();
        const dayString = day.getFullYear() + "-" + (("00" + (day.getMonth() + 1).toString()).slice(-2));
        const options_Elec = {
            url: `http://${CONFIG.ipark_server.address}/webapp/data/getEnergyAvr_monthly_Elec.php`,
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Cookie': `PHPSESSID=${this._cookieInfo.phpsessid}; user_id=${this._cookieInfo.userid}; user_name=${this._cookieInfo.username}`,
            },
            qs: {
                eDate3: dayString, // 가져올 데이터 날짜
            },
        };
        this.IparkServerStatusParse2(options_Elec, 'energy_elec');
        const options_Water = {
            url: `http://${CONFIG.ipark_server.address}/webapp/data/getEnergyAvr_monthly_Water.php`,
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Cookie': `PHPSESSID=${this._cookieInfo.phpsessid}; user_id=${this._cookieInfo.userid}; user_name=${this._cookieInfo.username}`,
            },
            qs: {
                eDate3: dayString, // 가져올 데이터 날짜
            },
        };
        this.IparkServerStatusParse2(options_Water, 'energy_water');
        const options_Gas = {
            url: `http://${CONFIG.ipark_server.address}/webapp/data/getEnergyAvr_monthly_Gas.php`,
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Cookie': `PHPSESSID=${this._cookieInfo.phpsessid}; user_id=${this._cookieInfo.userid}; user_name=${this._cookieInfo.username}`,
            },
            qs: {
                eDate3: dayString, // 가져올 데이터 날짜
            },
        };
        this.IparkServerStatusParse2(options_Gas, 'energy_gas');
        const options_Hwater = {
            url: `http://${CONFIG.ipark_server.address}/webapp/data/getEnergyAvr_monthly_Hwater.php`,
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Cookie': `PHPSESSID=${this._cookieInfo.phpsessid}; user_id=${this._cookieInfo.userid}; user_name=${this._cookieInfo.username}`,
            },
            qs: {
                eDate3: dayString, // 가져올 데이터 날짜
            },
        };
        this.IparkServerStatusParse2(options_Hwater, 'energy_hwater');
        const options_Heat = {
            url: `http://${CONFIG.ipark_server.address}/webapp/data/getEnergyAvr_monthly_Heat.php`,
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Cookie': `PHPSESSID=${this._cookieInfo.phpsessid}; user_id=${this._cookieInfo.userid}; user_name=${this._cookieInfo.username}`,
            },
            qs: {
                eDate3: dayString, // 가져올 데이터 날짜
            },
        };
        this.IparkServerStatusParse2(options_Heat, 'energy_heat');
    }

    IparkLightCmdOptions(num, act) {
        const options = {
            url: `http://${CONFIG.ipark_server.address}/webapp/data/getHomeDevice.php`,
            headers: {
                'accept': 'application/xml',
                'User-Agent': 'Mozilla/5.0',
                'Cookie': `PHPSESSID=${this._cookieInfo.phpsessid}; user_id=${this._cookieInfo.userid}; user_name=${this._cookieInfo.username}`,
            },
            qs: {
                req_name: 'remote_access_livinglight',
                req_action: 'control',
                req_unit_num: num,
                req_ctrl_action: act,
            },
        };
        this.IparkServerCommand(options, num, act);
    }

    IparkServerStatusParse(options, name) {
        request.get(options, (error, response, body) => {
            if (response.statusCode === 200) {
                switch (name) {
                    case 'light':
                        xml2js.parseString(body, (err, result) => {
                            if (err) {
                                log.warn(`xml parsing failed with error: ${err}`);
                                return;
                            }
                            if (result) {
                                const statusInfo = result.imap.service[0].status_info;
                                if (!statusInfo) {
                                    log.warn('json parsing failed: body property not found');
                                    return;
                                }
                                try {
                                    statusInfo.forEach(status => {
                                        const unitNum = status.$.unit_num.replace(/switch/g, 'power');
                                        const unitStatus = status.$.unit_status;

                                        this.updateProperty('light', 'living', unitNum, unitStatus);
                                    });
                                } catch (e) {
                                    log.warn(`xml parsing failed with error: ${e}`);
                                }
                            }
                        });
                        break;
                    case 'vehicle':
                        try {
                            const vehicle_parse = JSON.parse(body);
                            if (!vehicle_parse[0]) {
                                log.warn('json parsing failed: body property not found');
                                return;
                            }
                            const vehicle_result = {
                                "주차날짜": vehicle_parse[0].Dpark_date,
                                "차량번호": vehicle_parse[0].car_num.replace(/차량번호:&nbsp;/, ''),
                                "주차위치": vehicle_parse[0].park_loca.replace(/주차위치:&nbsp;/, ''),
                            }
                            this.updateProperty('vehicle', vehicle_parse[0].rownum, 'info', JSON.stringify(vehicle_result));
                        } catch (e) {
                            log.warn(`json parsing failed with error: ${e}`);
                        }
                        break;
                    case 'delivery':
                        try {
                            const delivery_parse = JSON.parse(body);
                            if (!delivery_parse[0]) {
                                //warn('json parsing failed: body property not found');
                                return;
                            }
                            const delivery_result = {
                                "보관날짜": delivery_parse[0].Rregdate,
                                "보관위치": delivery_parse[0].box_num,
                                "보관상태": delivery_parse[0].action,
                            }
                            this.updateProperty('delivery', delivery_parse[0].rownum, 'info', JSON.stringify(delivery_result));
                        } catch (e) {
                            log.warn(`json parsing failed with error: ${e}`);
                        }
                        break;
                }
            } else {
                log.warn(`request failed with error: ${error}`);
            }
        });
    }

    IparkServerStatusParse2(options, name) {
        request.get(options, (error, response, body) => {
            if (response.statusCode === 200) {
                let parse = undefined;
                let result = undefined;
                const propName = name.split("_")[1];
                try {
                    switch (name) {
                        case 'energy_elec':
                            parse = JSON.parse(body);
                            result = {
                                "total_elec_usage": parse[1].data[2],
                                "average_elec_usage": parse[0].data[2],
                            }
                            break;
                        case 'energy_water':
                            parse = JSON.parse(body);
                            result = {
                                "total_water_usage": parse[1].data[2],
                                "average_water_usage": parse[0].data[2],
                            }
                            break;
                        case 'energy_gas':
                            parse = JSON.parse(body);
                            result = {
                                "total_gas_usage": parse[1].data[2],
                                "average_gas_usage": parse[0].data[2],
                            }
                            break;
                        case 'energy_hwater':
                            parse = JSON.parse(body);
                            result = {
                                "total_hwater_usage": parse[1].data[2],
                                "average_hwater_usage": parse[0].data[2],
                            }
                            break;
                        case 'energy_heat':
                            parse = JSON.parse(body);
                            result = {
                                "total_heat_usage": parse[1].data[2],
                                "average_heat_usage": parse[0].data[2],
                            }
                            break;
                    }
                    for (const [key, value] of Object.entries(result)) {
                        if (key.includes('total')) {
                            this.updateProperty('energy', propName, 'total', value);
                        }
                        if (key.includes('average')) {
                            this.updateProperty('energy', propName, 'equilibrium_average', value);
                        }
                    }
                } catch (e) {
                    log.warn(`json parsing failed with error: ${e}`);
                }
            } else {
                log.warn(`request failed with error: ${error}`);
            }
        });
    }

    IparkServerCommand(options, num, act) {
        request.get(options, (error, response) => {
            if (response.statusCode === 200) {
                try {
                    let unitNum = num.replace(/switch/g, 'power');
                    log.info(`request Successful: ${unitNum} ${act}`);
                    this.mqttClientUpdate('light', 'living', unitNum, act);
                } catch (e) {
                    log.warn(`request failed light with error: ${e}`);
                }
            } else {
                log.warn(`request failed with error: ${error}`);
            }
        });
    }
};

_rs485 = new rs485();
