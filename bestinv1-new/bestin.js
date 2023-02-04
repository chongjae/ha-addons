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
const CONFIG = require('/data/options.json');  


// 각 디바이스 설정
const energyVar = {
    type: CONFIG.energy.type,
    serName: CONFIG.energy.serName,
    addr: CONFIG.energy.address,
    port: CONFIG.energy.port
};
const controlVar = {
    type: CONFIG.control.type,
    serName: CONFIG.control.serName,
    addr: CONFIG.control.address,
    port: CONFIG.control.port
};
const smart1Var = {
    type: CONFIG.smart1.type,
    serName: CONFIG.smart1.serName,
    addr: CONFIG.smart1.address,
    port: CONFIG.smart1.port
};
const smart2Var = {
    type: CONFIG.smart2.type,
    serName: CONFIG.smart2.serName,
    addr: CONFIG.smart2.address,
    port: CONFIG.smart2.port
};

const serverVar = {
    server: CONFIG.ipark_server.server,
    username: CONFIG.ipark_server.username,
    password: CONFIG.ipark_server.password,
}

// MQTT 설정
const mqttVar = {
    broker: CONFIG.mqtt.broker,
    port: CONFIG.mqtt.port,
    username: CONFIG.mqtt.username,
    password: CONFIG.mqtt.password,
};

const CONST = {
    // 시리얼 전송 설정
    sendDelay: CONFIG.sendDelay,
    maxRetry: CONFIG.maxRetry,
    // 연결 딜레이 설정
    scanInterval: CONFIG.server_interval, // 단지서버 상태조회 간격(default: 60s)
    // 메시지 Prefix 상수
    MSG_PREFIX: [0x02],
    MSG_HEADER: [0x31, 0x41, 0x42, 0xd1, 0x28, 0x61, 0xc1],
    // Mqtt 토픽
    TOPIC_PRFIX: 'bestin',
    STATE_TOPIC: 'bestin/%s/%s/%s/state',
    DEVICE_TOPIC: 'bestin/+/+/+/command',
    HA_TOPIC: 'homeassistant/status'
};

// 베스틴 홈넷용 시리얼 통신 파서 : 메시지 길이나 구분자가 불규칙하여 별도 파서 정의
class CustomParser extends Transform {
    constructor(options) {
        super(options);
        this._queueChunk = [];
        this._msgLenCount = 0;
        this._msgLength = 0;
        this._msgTypeFlag = false;
    }

    _transform(chunk, encoding, done) {
        let start = 0;
        for (let i = 0; i < chunk.length; i++) {
            if (CONST.MSG_PREFIX.includes(chunk[i]) && CONST.MSG_HEADER.includes(chunk[i + 1])) {
                this._queueChunk.push(chunk.slice(start, i));
                this.push(Buffer.concat(this._queueChunk));
                this._queueChunk = [];
                this._msgLenCount = 0;
                start = i;
                this._msgTypeFlag = true;
            } else if (this._msgTypeFlag) {
                this._msgLength = this.determineLength(chunk[i + 2]);
                this._msgTypeFlag = false;
            }

            if (this._msgLenCount === this._msgLength - 1) {
                this._queueChunk.push(chunk.slice(start, i + 1));
                this.push(Buffer.concat(this._queueChunk));
                this._queueChunk = [];
                this._msgLenCount = 0;
                start = i + 1;
            } else {
                this._msgLenCount++;
            }
        }
        this._queueChunk.push(chunk.slice(start));
        done();
    }

    determineLength(value) {
        switch (value) {
            case 0x1e:
                return 30;
            case 0x30:
                return 48;
            case 0x10:
                return 16;
            case 0x00: case 0x80:
                return 10;
            default:
            //return;
        }
    }
}

// 로그 표시 
const log = (...args) => console.log('[' + (new Date()).toLocaleString() + ']', 'INFO     ', args.join(' '));
const warn = (...args) => console.warn('[' + (new Date()).toLocaleString() + ']', 'WARNING  ', args.join(' '));
const error = (...args) => console.error('[' + (new Date()).toLocaleString() + ']', 'ERROR    ', args.join(' '));

// 홈컨트롤 상태
let homeStatus = {};
let lastReceive = new Date().getTime();
let mqttReady = false;
let queue = new Array();
let retryCnt = 0;  // 수정금지
//let result_server = {}; //단지 서버
let packetCommnad = {};
let result = {}; // rs485
let stamp;
let stamp1;

// MQTT-Broker 연결 
const client = mqtt.connect('mqtt://' + mqttVar.broker, {
    port: mqttVar.port,
    username: mqttVar.username,
    password: mqttVar.password,
    clientId: 'BESTIN_WALLPAD',
});

client.on('connect', () => {
    log("INFO     MQTT connection successful!");
    const topics = [CONST.DEVICE_TOPIC, CONST.HA_TOPIC];
    topics.forEach(topic => {
        client.subscribe(topic, (err) => {
            if (err) {
                log(`ERROR    Failed to subscribe to ${topic}`);
            }
        });
    });
});

client.on("reconnect", function () {
    log("WARNING  MQTT connection lost. Attempting to reconnect...");
});
log('INFO     Initializing MQTT...');

const InitConnection = (name, any) => {
    log(`INFO     Initializing ${any.type}-${name}...`)
    let connection, dataStream;

    if (any.type === 'serial') {
        connection = new SerialPort({
            path: any.serName,
            baudRate: 9600,
            dataBits: 8,
            parity: 'none',
            stopBits: 1,
            autoOpen: false,
            encoding: 'hex'
        });
        dataStream = connection.pipe(new CustomParser());
        connection.on('open', () => {
            log(`INFO     Successfully opened ${name} port: ${any.serName}`);
        });
        connection.on('close', () => {
            log(`WARNING  Closed ${name} port: ${any.serName}`);
        });
        connection.open((err) => {
            if (err) {
                log(`WARNING  Failed to open ${name} port: ${err.message}`);
                return;
            }
        });

        return { connection, dataStream };
    } else {
        connection = new net.Socket();
        connection.connect(any.port, any.addr, () => {
            log(`INFO     Successfully connected to ${name}`);
        });
        connection.on('error', (err) => {
            log(`ERROR    Connection error ${err.code}::${name.toUpperCase()}. Attempting to reconnect...`);
            connection.connect(any.port, any.addr, () => {
            });
        });
        dataStream = connection.pipe(new CustomParser());
    }

    return { connection, dataStream };
}

const energy = InitConnection('energy', energyVar);
const control = InitConnection('control', controlVar);

// crc 계산
function CheckSum(data, count) {
    let sum = AddSum(data, count);
    if (sum != data[count]) {
        return sum;
    }
    return true;
}

function AddSum(data, count) {
    let sum = 3;
    for (var i = 0; i < count; i++) {
        sum = ((data[i] ^ sum) + 1)
    }

    return sum;
}

// 거실 조명
async function cookieParser() {
    return new Promise((resolve, reject) => {
        request.get(`http://${serverVar.server}/webapp/data/getLoginWebApp.php?devce=WA&login_ide=${serverVar.username}&login_pwd=${serverVar.password}`, function (error, response, body) {
            if (!error && response.statusCode == 200) {
                log('INFO     I-Park Server Login Successful!');

                const cookies = response.headers['set-cookie'];
                for (let i = 0; i < cookies.length; i++) {
                    if (cookies[i].startsWith('PHPSESSID=')) {
                        phpsessid = cookies[i].split(';')[0].split('=')[1];
                    } else if (cookies[i].startsWith('user_id=')) {
                        userId = cookies[i].split(';')[0].split('=')[1];
                    } else if (cookies[i].startsWith('user_name=')) {
                        userName = cookies[i].split(';')[0].split('=')[1];
                    }
                }
            }

            cookie = {
                php: phpsessid,
                id: userId,
                name: userName,
            };
            resolve(cookie);
            reject(new Error('ERROR    I-Park Server request failed'))
        });
    });
}

if (!fs.existsSync('./cookie.json')) {
    //fs.writeFileSync('./cookie.json', "{}", 'utf8');
    cookieParser().then(function (cookie) {
        fs.writeFileSync('./cookie.json', JSON.stringify(cookie), 'utf8');
        log('INFO     Cookie saved successfully!');
    });
} else {
    log('INFO     already cookie saved pass');
}

async function serverStatus() {
    const cookie = JSON.parse(fs.readFileSync('./cookie.json', 'utf8'));
    const options_light_state = {
        url: `http://${serverVar.server}/webapp/data/getHomeDevice.php`,
        headers: {
            'User-Agent': 'Mozilla/5.0',
            'Cookie': `PHPSESSID=${cookie.php}; user_id=${cookie.id}; user_name=${cookie.name}`,
        },
        qs: {
            req_name: 'remote_access_livinglight',
            req_action: 'status',
        },
    };
    await serverlightStatus(options_light_state);
    //console.log(options_light_state)
}

async function serverlightStatus(light_state) {
    startInterval(CONST.scanInterval, async function () {
        request.get(light_state, (error, response, body) => {

            if (!error && response.statusCode == 200) {
                xml2js.parseString(body, (error, result) => {
                    if (!error && result) {
                        const statusInfos = result?.imap.service[0].status_info;
                        for (let i = 0; i < statusInfos?.length; i++) {
                            result_server = {
                                device: 'light',
                                room_index: 'living',
                                index: ((statusInfos[i].$.unit_num).slice(6, 7)),
                                power: (statusInfos[i].$.unit_status)
                            }
                            updateStatus(result_server);
                        }
                    }
                });
            }

        });
    });
}

function startInterval(seconds, callback) {
    callback();
    return setInterval(callback, seconds * 1000);
}

async function serverControl(switch_num, switch_action) {
    //await cookieParser();
    const cookie = JSON.parse(fs.readFileSync('./cookie.json', 'utf8'));
    const options_light_command = {
        url: `http://${serverVar.server}/webapp/data/getHomeDevice.php`,
        method: 'GET',
        headers: {
            'accept': 'application/xml',
            'User-Agent': 'Mozilla/5.0',
            'Cookie': `PHPSESSID=${cookie.php}; user_id=${cookie.id}; user_name=${cookie.name}`,
        },
        qs: {
            req_name: 'remote_access_livinglight',
            req_action: 'control',
            req_unit_num: 'switch' + switch_num,
            req_ctrl_action: switch_action,
        },
    };
    await serverlightControl(options_light_command, switch_num, switch_action);
    //console.log(options_light_command)
}

async function serverlightControl(light_command, num, act) {
    request.get(light_command, (error, response, body) => {
        //console.log(body)
        if (!error && response.statusCode == 200) {
            log(`INFO     Success command Num:: ${'living ' + num}`);
            result_server = {
                device: 'light',
                room_index: 'living',
                index: num,
                power: act
            };
            updateStatus(result_server);
        }
    });
}

async function init() {
    await cookieParser();
    await serverStatus();
}

init();

function handleEnergyStateParser(data) {
    switch (data[3]) {
        case 0x91:
            // 조명
            room_idx = data[5] & 0x0f;
            for (let i = 0; i < 3; i++) {
                state = ((data[6] & (1 << i)) ? 'on' : 'off');
                result = {
                    device: 'light',
                    room_index: room_idx,
                    index: i + 1,
                    power: state
                }
                updateStatus(result)
            }

            // 콘센트
            room_idx = data[5] & 0x0f;
            standby_power = ((data[7] >> 4 & 1) ? 'on' : 'off');
            for (let i = 0; i < 3; i++) {
                result = ((data[7] & (0x01 << i)) ? 'on' : 'off');
                i1 = 14 + 2 * i;
                i2 = i1 + 2;
                if (data.length > i2) {
                    value = parseInt(data.slice(i1, i2).toString('hex'), 16)
                    consumption = value / 10;
                } else {
                    consumption = 0;
                }
                result = {
                    device: 'outlet',
                    room_index: room_idx,
                    index: i + 1,
                    power: state,
                    current: consumption
                }
                result = {
                    device: 'outlet',
                    room_index: room_idx,
                    standby_power: standby_power,
                }
                updateStatus(result)
            }
            break;

        case 0x82:
            function convertToHexString(startIndex, data) {
                return ((data[startIndex].toString(16)).padStart(2, '0') + (data[startIndex + 1].toString(16)).padStart(2, '0'));
            }
            const startIndex = {
                electric: 13,
                heat: 21,
                hotwater: 29,
                gas: 37,
                water: 45
            };

            for (let key in startIndex) {
                consumption = convertToHexString(startIndex[key], data)
                result = {
                    device: 'hems',
                    index: key,
                    current: consumption
                }
                updateStatus(result)
            }
            break;

        case 0x81:
            deviceCommand = queue.findIndex(
                (e) =>
                    data[0] == e.commandHex[0] &&
                    data[1] == e.commandHex[1] &&
                    data[3] == 0x81
            );
            if (deviceCommand > -1) {
                log(`INFO     Success command #= ${retryCnt}`);
                queue.splice(deviceCommand, 1);
                retryCnt = 0;
            }
            break;
    }
}

function handleControlStateParser(data) {
    deviceCommand = queue.findIndex(
        (e) =>
            data[0] == e.commandHex[0] &&
            data[1] == e.commandHex[1]
    );

    switch (data[1]) {
        case 0x31:
            switch (data[2]) {
                case 0x80:
                    state = (data[5] & 0x01) ? 'on' : 'off';
                    result = {
                        device: 'gas',
                        index: 1,
                        power: state
                    }
                    break;
                case 0x82:
                    if (deviceCommand > -1) {
                        log(`INFO     Success command #= ${retryCnt}`);
                        queue.splice(deviceCommand, 1);
                        retryCnt = 0;
                    }
                    break;
            }
            break;

        case 0x41:
            switch (data[2]) {
                case 0x80:
                    state = (data[5] & 0x02) ? 'UNLOCK' : 'LOCK';
                    result = {
                        device: 'doorlock',
                        index: 1,
                        power: state
                    }
                    break;
                case 0x82:
                    if (deviceCommand > -1) {
                        log(`INFO     Success command #= ${retryCnt}`);
                        queue.splice(deviceCommand, 1);
                        retryCnt = 0;
                    }
                    break;
            }
            break;

        case 0x61:
            switch (data[2]) {
                case 0x80:
                    state = (data[5] & 0x01) ? 'on' : 'off';
                    speed = data[6];
                    result = {
                        device: 'ventil',
                        index: 1,
                        power: state,
                        speed: speed
                    }
                    break;
                case 0x81:
                case 0x83:
                case 0x87:
                    if (deviceCommand > -1) {
                        log(`INFO     Success command #= ${retryCnt}`);
                        queue.splice(deviceCommand, 1);
                        retryCnt = 0;
                    }
                    break;
            }
            break;

        case 0x28:
            switch (data[3]) {
                case 0x91:
                    room_idx = data[5] & 0x0f;
                    state = (data[6] & 0x01) ? 'heat' : 'off';
                    setting = (data[7] & 0x3f) + ((data[7] & 0x40) > 0) * 0.5;
                    current = parseInt((data.slice(8, 10)).toString('hex'), 16) / 10.0;
                    result = {
                        device: 'thermostat',
                        room_index: room_idx,
                        power: state,
                        setting: setting,
                        current: current
                    }
                case 0x92:
                    if (deviceCommand > -1) {
                        log(`INFO     Success command #= ${retryCnt}`);
                        queue.splice(deviceCommand, 1);
                        retryCnt = 0;
                    }
                    break;
            }
            break;
    }
    updateStatus(result)

}

function makePacket(topic, message) {
    var topoic_split = topic[2].split("_");
    var room_index = topoic_split[0];
    var index = topoic_split[1];

    switch (topic[1]) {
        case 'light':
            packet = createCommmonPacket(0x31, 13, 0x01, stamp);
            packet[5] = room_index & 0x0f
            packet[6] = 0x01 << index - 1

            if (message == 'on') {
                packet[6] += 0x80
                packet[11] = 0x04
            } else {
                packet[11] = 0x00
            }
            packet[12] = CheckSum(packet, 12);
            break;
        case 'outlet':
            packet = createCommmonPacket(0x31, 13, 0x01, stamp);
            if (topic[3] == 'power') {
                packet[5] = room_index & 0x0f
                packet[7] = 0x01 << index - 1

                if (message == 'on') {
                    packet[7] += 0x80
                    packet[11] = 0x09 << index - 1
                } else {
                    packet[11] = 0x00
                }
                packet[12] = CheckSum(packet, 12);
            } else if (topic[3] == 'standby_power') {
                packet[5] = room_index & 0x0f

                if (message == 'on') {
                    packet[8] = 0x83
                } else {
                    packet[8] = 0x03
                }
                packet[12] = CheckSum(packet, 12);
            }
            break;
        case 'thermostat':
            packet = createCommmonPacket(0x28, 14, 0x12, stamp1);
            if (topic[3] == 'power') {
                packet[5] = room_index & 0x0f

                if (message == 'heat') {
                    packet[6] = 0x01
                } else {
                    packet[6] = 0x02
                }
                packet[13] = CheckSum(packet, 13);
            } else if (topic[3] == 'setting') {
                packet[5] = room_index & 0x0f
                value_int = parseInt(message)
                value_float = message - value_int
                packet[7] = value_int & 0xff
                if (value_float != 0) {
                    packet[7] += 0x40
                }
                packet[13] = CheckSum(packet, 13);
            }
            break;
        case 'ventil':
            if (topic[3] == 'power') {
                if (message == 'on') {
                    tatget = 0x01
                } else {
                    tatget = 0x00
                }
                var packet = [0x02, 0x61, 0x01, '0x' + stamp1 & 0xff, 0x00, tatget, 0x01, 0x00, 0x00];
                packet[9] = CheckSum(packet, 9);
            } else if (topic[3] == 'speed') {
                var packet = [0x02, 0x61, 0x03, '0x' + stamp1 & 0xff, 0x00, 0x00, '0x0' + message, 0x00, 0x00];
                packet[9] = CheckSum(packet, 9);
            }
            break;
        case 'gas':
            if (message == 'on') {
                return packet = []
            } else {
                packet = [0x02, 0x31, 0x02, '0x' + stamp1 & 0xff, 0x00, 0x00, 0x00, 0x00, 0x00]
                packet[9] = CheckSum(packet, 9);
            }
            break;
        case 'doorlock':
            if (message == 'on') {
                var packet = [0x02, 0x41, 0x02, '0x' + stamp1 & 0xff, 0x01, 0x00, 0x00, 0x00, 0x00];
                packet[9] = CheckSum(packet, 9);
            } else {
                return packet = []
            }
    }
    packetCommnad = {
        device: topic[1],
        room_index: room_index,
        index: index,
        [topic[3]]: message,
        sentTime: 0,
        commandHex: Buffer.from(packet)
    }
};

function createCommmonPacket(header, length, packet_type, timestamp) {
    return [0x02, header & 0xff, length & 0xff, packet_type & 0xff, '0x' + timestamp & 0xff].concat(Array(length - 5).fill(0));
};

// 홈넷에서 SerialPort로 상태 정보 수신
energy.dataStream.on('data', function (data) {
    lastReceive = new Date().getTime();
    stamp = data.slice(4, 5).toString('hex');

    if (data.length == 30) {
        handleEnergyStateParser(data);
    } else if (data.length == 48) {
        handleEnergyStateParser(data);
    }
});

control.dataStream.on('data', function (data) {
    lastReceive = new Date().getTime();
    if (data[1] == (0x31 || 0x61)) {
        stamp1 = data.slice(3, 4).toString('hex');
    } else {
        stamp1 = data.slice(4, 5).toString('hex');
    }

    if (data.length == 10) {
        handleControlStateParser(data);
    } else if (data.length == 16) {
        handleControlStateParser(data);
    }
});

// MQTT Discovery 수행
function mqttDiscovery(obj, stateName) {

    if (obj.device == 'light') {
        //let maxIndex = (obj.room_index == 1) ? 3 : 2;
        //for (let index = 1; index <= maxIndex; index++) {
        //console.log('room_index:', obj.room_index, 'index:', index)
        var discoveryTopic = `homeassistant/light/bestin_wallpad/light_${obj.room_index}_${index}/config`;
        var discoveryPayload = {
            name: `bestin_light_${obj.room_index}_${index}`, //bestin_light_1_1
            cmd_t: `bestin/light/${obj.room_index}_${index}/power/command`,
            stat_t: `bestin/light/${obj.room_index}_${index}/power/state`,
            uniq_id: `light_${obj.room_index}_${index}`,
            pl_on: 'on',
            pl_off: 'off',
            opt: false,
            device: {
                name: `BESTIN-Light`,
                ids: `BESTIN-Light`,
                mf: 'HDC',
                mdl: 'BESTIN',
                sw: '1.0'
            },
        };
        //}
        //console.log(discoveryTopic)
    }

    if (obj.device == 'outlet') {
        if (stateName == 'power') {
            //for (let index = 1; index <= 2; index++) {
            var discoveryTopic = `homeassistant/switch/bestin_wallpad/outlet_${obj.room_index}_${index}/config`;
            var discoveryPayload = {
                name: `bestin_outlet_${obj.room_index}_${index}`, //bestin_outlet_1_1
                cmd_t: `bestin/outlet/${obj.room_index}_${index}/power/command`,
                stat_t: `bestin/outlet/${obj.room_index}_${index}/power/state`,
                uniq_id: `outlet_${obj.room_index}_${index}`,
                pl_on: 'on',
                pl_off: 'off',
                ret: false,
                ic: 'mdi:power-socket-eu',
                device: {
                    name: `BESTIN-Outlet`,
                    ids: `BESTIN-Outlet`,
                    mf: 'HDC',
                    mdl: 'BESTIN',
                    sw: '1.0'
                },
            };
            //}
        }
        if (stateName == 'current') {
            //let maxIndex = (obj.room_index == 1) ? 3 : 2;
            //for (let index = 1; index <= maxIndex; index++) {
            var discoveryTopic = `homeassistant/sensor/bestin_wallpad/current_${obj.room_index}_${index}/config`;
            var discoveryPayload = {
                name: `bestin_power_usage_${obj.room_index}_${index}`, //bestin_power_usage_1_1
                stat_t: `bestin/outlet/${obj.room_index}_${index}/current/state`,
                uniq_id: `power_usage_${obj.room_index}_${index}`,
                unit_of_meas: 'Wh',
                ic: 'mdi:lightning-bolt',
                device: {
                    name: `BESTIN-Outlet`,
                    ids: `BESTIN-Outlet`,
                    mf: 'HDC',
                    mdl: 'BESTIN',
                    sw: '1.0'
                },
            };
            //}
        }
        if (stateName == 'standby_power') {
            var discoveryTopic = `homeassistant/switch/bestin_wallpad/standby_power_${obj.room_index}/config`;
            var discoveryPayload = {
                name: `bestin_standby_power_${obj.room_index}`, //bestin_standby_power_1
                cmd_t: `bestin/outlet/${obj.room_index}/standby_power/command`,
                stat_t: `bestin/outlet/${obj.room_index}/standby_power/state`,
                uniq_id: `standby_power_${obj.room_index}`,
                pl_on: 'on',
                pl_off: 'off',
                ret: false,
                ic: 'mdi:power-socket-it',
                device: {
                    name: `BESTIN-Outlet`,
                    ids: `BESTIN-Outlet`,
                    mf: 'HDC',
                    mdl: 'BESTIN',
                    sw: '1.0'
                },
            };
        }
    }

    if (obj.device == 'thermostat') {
        var discoveryTopic = `homeassistant/climate/bestin_wallpad/thermostat_${obj.room_index}/config`;
        var discoveryPayload = {
            name: `bestin_thermostat_${obj.room_index}`, //bestin_thermostat_1
            mode_cmd_t: `bestin/thermostat/${obj.room_index}/power/command`,
            mode_stat_t: `bestin/thermostat/${obj.room_index}/power/state`,
            temp_cmd_t: `bestin/thermostat/${obj.room_index}/setting/command`,
            temp_stat_t: `bestin/thermostat/${obj.room_index}/setting/state`,
            curr_temp_t: `bestin/thermostat/${obj.room_index}/current/state`,
            uniq_id: `thermostat_${obj.room_index}`,
            modes: ['off', 'heat'],
            min_temp: 5,
            max_temp: 40,
            temp_step: 0.5,
            device: {
                name: `BESTIN-Thermostat`,
                ids: `BESTIN-Thermostat`,
                mf: 'HDC',
                mdl: 'BESTIN',
                sw: '1.0'
            },
        };
    }

    if (obj.device == 'gas') {
        var discoveryTopic = `homeassistant/switch/bestin_wallpad/gas_${obj.index}/config`;
        var discoveryPayload = {
            name: `bestin_gas_${obj.index}`, //bestin_gas_1
            cmd_t: `bestin/gas/${obj.index}/power/command`,
            stat_t: `bestin/gas/${obj.index}/power/state`,
            uniq_id: `gas_${obj.index}`,
            pl_on: 'on',
            pl_off: 'off',
            ic: 'mdi:gas-cylinder',
            ret: false,
            device: {
                name: `BESTIN-Etc`,
                ids: `BESTIN-Etc`,
                mf: 'HDC',
                mdl: 'BESTIN',
                sw: '1.0'
            },
        };
    }

    if (obj.device == 'ventil') {
        var discoveryTopic = `homeassistant/fan/bestin_wallpad/fan_${obj.index}/config`;
        var discoveryPayload = {
            name: `bestin_fan_${obj.index}`, //bestin_fan_1
            cmd_t: `bestin/ventil/${obj.index}/power/command`,
            stat_t: `bestin/ventil/${obj.index}/power/state`,
            pr_mode_cmd_t: `bestin/ventil/${obj.index}/speed/command`,
            pr_mode_stat_t: `bestin/ventil/${obj.index}/speed/state`,
            pr_modes: ['1', '2', '3'],
            uniq_id: `fan_${obj.index}`,
            pl_on: 'on',
            pl_off: 'off',
            device: {
                name: `BESTIN-Etc`,
                ids: `BESTIN-Etc`,
                mf: 'HDC',
                mdl: 'BESTIN',
                sw: '1.0'
            },
        };
    }


    if (obj.device == 'doorlock') {
        var discoveryTopic = `homeassistant/lock/bestin_wallpad/doorlock_${obj.index}/config`;
        var discoveryPayload = {
            name: `bestin_doorlock_${obj.index}`, //bestin_doorlock_1
            cmd_t: `bestin/doorlock/${obj.index}/power/command`,
            stat_t: `bestin/doorlock/${obj.index}/power/state`,
            opt: false,
            ret: false,
            uniq_id: `doorlock_${obj.index}`,
            device: {
                name: `BESTIN-Etc`,
                ids: `BESTIN-Etc`,
                mf: 'HDC',
                mdl: 'BESTIN',
                sw: '1.0'
            },
        };
    }

    if (obj.device == 'hems') {
        var discoveryTopic = `homeassistant/sensor/bestin_wallpad/hems_${obj.index}/config`;
        var discoveryPayload = {
            name: `bestin_${obj.index}_consumption`, //bestin_electric_consumption
            stat_t: `bestin/hems/${obj.index}/current/state`,
            unit_of_meas: obj.index == "electric" ? "kWh" : (obj.index == "heat" ? "MWh" : "m³"),
            ic: obj.index == "electric" ? "mdi:flash" : (obj.index == "heat" ? "mdi:radiator" : (obj.index == "gas" ? "mdi:fire" : (obj.index == "hotwater" ? "mdi:hot-tub" : "mdi:water"))),
            uniq_id: `${obj.index}_consumption`,
            device: {
                name: `BESTIN-Hems`,
                ids: `BESTIN-Hems`,
                mf: 'HDC',
                mdl: 'BESTIN',
                sw: '1.0'
            },
        };
    }
    client.publish(discoveryTopic, JSON.stringify(discoveryPayload), { retain: true });
};

// MQTT로 HA에 상태값 전송
const updateStatus = (obj) => {
    if (!obj) return null;

    const filter = ['power', 'standby_power', 'setting', 'current', 'speed'];
    const stateNames = Object.keys(obj).filter(stateName => filter.includes(stateName));

    stateNames.forEach((stateName) => {
        const { device, room_index, index } = obj;
        const key = `${device}${room_index}${index}${stateName}`;
        const statusChanged = obj[stateName] !== homeStatus[key];
        mqttDiscovery(obj, stateName);

        if (statusChanged) {
            homeStatus[key] = obj[stateName];
            const topic = createMqttTopic(obj, stateName);
            client.publish(topic, obj[stateName]?.toString(), { retain: true });

            if (stateName !== 'current') {
                log('INFO     publish to MQTT:', topic, '=', obj[stateName]);
            }
        }
    });
};

const createMqttTopic = (obj, stateName) => {
    let topic = `bestin/${obj.device}`;
    if (obj.room_index && obj.index) {
        topic += `/${obj.room_index}_${obj.index}`;
    }
    if (obj.room_index == undefined) {
        topic += `/${obj.index}`;
    }
    if (obj.index == undefined) {
        topic += `/${obj.room_index}`;
    }
    topic += `/${stateName}/state`;
    return topic;
};

client.on('message', (topic, message) => {
    if (!mqttReady) return;
    const topics = topic.split('/');
    const value = message.toString();

    if (value === homeStatus[result.device + result.room_index + result.index + result[topics[3]]]) {
        log('INFO     MQTT Receive & Skip: ', topic, ':', value);
    } else if (topics[2]?.includes('living')) {
        const topic_delimiter = topics[2]?.split("_");
        serverControl(topic_delimiter[1], value);
    } else {
        makePacket(topics, value);
        if (topics[0] == CONST.TOPIC_PRFIX) {

        }
        log('INFO     Receive from MQTT:', topic, ':', value);
        packetCommnad.sentTime = Date.now() - CONST.sendDelay;
        queue.push(packetCommnad);
        updateStatus(packetCommnad);
        retryCnt = 0;
    }
});

const commandProc = () => {
    if (queue.length === 0) {
        return;
    }

    if (!mqttReady) return;
    var delay = (new Date().getTime()) - lastReceive;
    if (delay < CONST.sendDelay) return;

    const obj = queue.shift();
    var device = obj.device;
    const commandHex = obj.commandHex;

    switch (device) {
        case 'light':
        case 'outlet':
            energy.connection.write(commandHex, handleWriteError);
            log('INFO     Send to Device:', commandHex.toString('hex'));
            break;
        case 'ventil':
        case 'thermostat':
        case 'gas':
        case 'doorlock':
            control.connection.write(commandHex, handleWriteError);
            log('INFO     Send to Device:', commandHex.toString('hex'));
            break;
        //case 'elevator':
        //    break;
    }
    obj.sentTime = lastReceive;

    retryCnt++;
    if (retryCnt < CONST.maxRetry) {
        queue.push(obj);
    } else {
        let firstStr = device?.charAt(0);
        let others = device?.slice(1);
        log(`WARNING  #${firstStr.toUpperCase() + others} max retry count exceeded! ${commandHex.toString('hex')}`);
        retryCnt = 0;
    }
};

const handleWriteError = (err) => {
    if (err) {
        log('ERROR    Send error:', err.message);
    }
};

setInterval(commandProc, 20);
setTimeout(() => { mqttReady = true }, 2000);

