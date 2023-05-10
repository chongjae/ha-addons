/* for easy-roll Smart Blind */

const request = require('request');
const mqtt = require('mqtt');
const logger = require('simple-node-logger').createSimpleLogger();

////////////////////////////////
const conf = require('/data/options.json');

const stateUrl = `http://{}:20318/lstinfo`;
const actionUrl = `http://{}:20318/action`;

let mqttRemain = '';
let previous = {};

let _mqttReady = false;
let _discovery = false;

const parameter = {
    'OPEN': 'TU',
    'CLOSE': 'BD',
    'STOP': 'SS',
};

const client = mqtt.connect({
    host: conf.mqtts[0].server,
    port: conf.mqtts[0].port,
    username: conf.mqtts[0].username,
    password: conf.mqtts[0].password,
});
logger.info('initialize mqtt...');

client.on('connect', () => {
    logger.info('MQTT connection successful!');
    _mqttReady = true;

    const topic = 'easyroll/+/+/+/command'

    client.subscribe(topic, (err) => {
        if (err) logger.error(`subscribe failed: ${topic}`);
        else logger.info(`subscribe: ${topic}`);
    });
});

client.on('error', (err) => {
    logger.error(`MQTT connection error: ${err}`);
    _mqttReady = false;

});

client.on('reconnect', () => {
    logger.warn('MQTT connection lost. try to reconnect...');
});

function easyrollFind() {
    let info = [];
    for (const [idx, addr] of Object.entries(conf.blinds)) {
        info.push(idx + 1, addr);
    }
    return info;
}

function easyrollPos(arg) {
    const host = easyrollFind();
    request.get(stateUrl.replace('{}', host[1]), function (error, response, body) {
        const state = JSON.parse(body);

        if (error || state.result !== 'success') {
            const err = [error, state.result];
            logger.error(`easyroll blind(index: ${host[0]}) state error: ${err}`);
            return;
        }

        if (response.statusCode === 200 && state.result === 'success') {
            if (arg === 'req') {
                logger.info(`easyroll blind(index: ${host[0]}) state request success! [${state.serial_number}::${state.local_ip}]`);
            } else if (arg === 'poll') {

            }

            const result = {
                serial_number: state.serial_number.toLowerCase(),
                index: host[0],
                ip: state.local_ip,
                position: String(Math.floor(state.position))
            };
            ////////////////////////////////
            easyrollParse(result);
        }
    });
};

easyrollPos('req');
setInterval(easyrollPos, conf.scan_interval * 1000, 'req');


function easyrollCmd(url, id) {
    request.post(url, function (error, response, body) {
        const state = JSON.parse(body);

        if (error || state.result !== 'success') {
            const err = [error, state.result];
            logger.error(`easyroll blind(index: ${id}) state error: ${err}`);
            return;
        }

        if (response.statusCode === 200 && state.result === 'success') {
            logger.info(`easyroll blind(index: ${id}) command request success!`);
            const interval = setInterval(easyrollPos, 1000, 'poll');

            setTimeout(() => {
                clearInterval(interval)
            }, conf.command_interval * 1000);
        }
    });
};

function easyrollParse(result) {
    const STATUS_CLOSED = 'closed';
    const STATUS_OPEN = 'open';
    const STATUS_CLOSING = 'closing';
    const STATUS_OPENING = 'opening';
    const STATUS_STOPPED = 'stopped';

    let action = '';
    if (result.position != 0 && result.position != 100 && mqttRemain) {
        if (mqttRemain == 'CLOSE') {
            action = STATUS_CLOSING;
        } else if (mqttRemain == 'OPEN') {
            action = STATUS_OPENING;
        } else if (mqttRemain == 'STOP') {
            action = STATUS_STOPPED;
        }
    } else {
        if (result.position == 0 || result.position < 100) {
            action = STATUS_OPEN;
        } else if (result.position == 100) {
            action = STATUS_CLOSED;
        }
    }

    if (_mqttReady != true) return;

    if (previous === '{}') {
        previous = result;
    }
    if (previous.serial_number === result.serial_number && previous.position === result.position) {
        return;
    }
    previous = result;

    easyrollUpdate(action, result);

    /////////////////////////////// 
    const discoveryOn = setImmediate(() => {
        if (!_discovery) {
            mqttDiscovery(result);
        } else {
            return true;
        }
    });

    setTimeout(() => {
        clearImmediate(discoveryOn);
        _discovery = true;
    }, 0);
};

function easyrollUpdate(action, state) {
    const topics = {
        [`easyroll/${state.index}/${state.serial_number}/position/state`]: action,
        [`easyroll/${state.index}/${state.serial_number}/percent/state`]: state.position
    };

    for (const [topic, value] of Object.entries(topics)) {
        client.publish(topic, value, { retain: true });
        logger.info(`publish mqtt: ${topic} = ${value}`);
    }
};

function mqttDiscovery(state) {
    let topic;
    let payload;

    topic = `homeassistant/cover/easyroll-${state.index}/${state.serial_number}/config`;
    payload = {
        name: `easyroll-${state.ip.split(':')[0]}`,
        cmd_t: `easyroll/${state.index}/${state.serial_number}/mode/command`,
        stat_t: `easyroll/${state.index}/${state.serial_number}/position/state`,
        pos_t: `easyroll/${state.index}/${state.serial_number}/percent/state`,
        set_pos_t: `easyroll/${state.index}/${state.serial_number}/percent/command`,
        pos_open: 0,
        pos_clsd: 100,
        uniq_id: `easyroll-${state.ip.split(':')[0]}`,
        device: {
            ids: "easyroll-blind",
            name: "easyroll-blind",
            mf: "Inoshade",
            mdl: "Inoshade-easyroll",
            sw: "harwin1/ha-addons/easyroll_blind",
        }
    }

    client.publish(topic, JSON.stringify(payload), { retain: true });
};

client.on('message', (topic, message) => {
    var topics = topic.split('/');
    var value = message.toString();
    var url = [];

    if (topics[0] !== 'easyroll') {
        logger.error(`Invalid topic prefix: ${topics[0]}`);
        return;
    }

    const host = easyrollFind();
    if (topics[1] === host[0]) {
        url.push(host[0], actionUrl.replace('{}', host[1]))
    }

    if (topics[3] === 'mode') {
        mqttRemain = value;
        easyrollCmd({
            url: url[1],
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                "mode": "general",
                "command": parameter[value]
            })
        }, url[0]);
    } else if (topics[3] === 'percent') {
        easyrollCmd({
            url: url[1],
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                "mode": "level",
                "command": value
            })
        }, url[0]);
    } else {
        logger.warn(`unknown command topic: ${topics[3]}`);
    }
});
