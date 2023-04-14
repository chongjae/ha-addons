/**
 * easyroll blind
 * @author harwin1
 */

const request = require('request');
const mqtt = require('mqtt');
const log = require('simple-node-logger').createSimpleLogger();
const Options = require('/data/options.json');

let mqtt_config_topics = [];
let address_array = [];
let previous_state = {};
let value_array = null;

for (let i = 0; i < Options.blind_connection; i++) {
    let address = Options.server['address' + (i + 1)];
    if (address == '') {
        log.warn(`not found address`);
        break;
    } else {
        log.info(`found address   index: ${i + 1}, address: ${address}`);
        address_array.push(address);
    }
}

const state_url = `http://{}:20318/lstinfo`;
const action_url = `http://{}:20318/action`;

const command_parameter = {
    'OPEN': 'TU',
    'CLOSE': 'BD',
    'STOP': 'SS',
    'squareup': 'SU',
    'squaredown': 'SD',
    'm1': 'M1',
    'm2': 'M2',
    'm3': 'M3',
};

const client = mqtt.connect(`mqtt://${Options.mqtt.broker}`, {
    port: Options.mqtt.port,
    username: Options.mqtt.username,
    password: Options.mqtt.password,
    clientId: 'easyroll_blind',
})
log.info('initialize mqtt...');

client.on('connect', () => {
    log.info('MQTT connection successful!');
    const topic = 'easyroll/+/+/command'
    client.subscribe(topic, (err) => {
        log.info(`subscribe: ${topic}`);
        if (err) log.error(`failed to subscribe to ${topic}`);
    });
})

client.on('error', (err) => {
    log.info(`MQTT connection error: ${err}`);
});

client.on('reconnect', () => {
    log.info('MQTT connection lost. try to reconnect...');
});

function updata_blind_position() {
    for (const [i, address] of Object.entries(address_array)) {
        request.get(state_url.replace('{}', address),
            function (error, response, body) {
                const state = JSON.parse(body);

                if (error || state.result != 'success') {
                    const err = [error, state.result];
                    log.info(`easyroll blind state error: ${err}`);
                    return;
                }

                if (response.statusCode == 200 && state.result == 'success') {
                    log.info(`easyroll blind state request success: ${state.serial_number}::${state.local_ip}`);
                    log.info(`easyroll blind update to position: ${Math.floor(state.position)}%`);

                    const blind_information = {
                        serial: state.serial_number.toLowerCase(),
                        ip: state.local_ip.split(':')[0],
                        position: String(Math.floor(state.position))
                    };
                    parse_blind_value(blind_information);
                }
            });
    }
}
function updata_blind_position_interval(socn, func) {
    func();

    return setTimeout(function () { updata_blind_position_interval(socn, func); }, socn);
}
updata_blind_position_interval((Options.scan_interval * 1000), updata_blind_position);

function blind_command_request(value, option_type) {
    for (const [i, address] of Object.entries(address_array)) {
        if (option_type == 'general') {
            op = {
                url: action_url.replace('{}', address),
                headers: {
                    'content-type': 'application/json'
                },
                body: JSON.stringify({
                    "mode": "general",
                    "command": command_parameter[value]
                })
            };
        } else {
            op = {
                url: action_url.replace('{}', address),
                headers: {
                    'content-type': 'application/json'
                },
                body: JSON.stringify({
                    "mode": "level",
                    "command": value
                })
            }
        }
        request.post(op, function (error, response, body) {
            const state = JSON.parse(body);

            if (error || state.result != 'success') {
                const err = [error, state.result];
                log.error(`easyroll blind state error: ${err}`);
                return;
            }

            if (response.statusCode == 200 && state.result == 'success') {
                log.info(`easyroll blind command[${value}] request success!`);
            }
        });
    }
}

function parse_blind_value(state) {
    if (state.position == 100) {
        blind_moving = 'closed';
    } else if (state.position < 100 && !['OPEN', 'CLOSE', 'STOP'].includes(value_array)) {
        blind_moving = 'open';
    } else if (value_array == 'CLOSE') {
        blind_moving = 'closing';
    } else if (value_array == 'OPEN') {
        blind_moving = 'opening';
    } else if (value_array == 'STOP') {
        blind_moving = 'stopped';
    }


    if (previous_state == {}) {
        previous_state = state;
    } else if (previous_state.serial === state.serial && previous_state.position === state.position) {
        return;
    }
    previous_state = state

    mqtt_discovery(state);

    const topics = [[`easyroll/${state.serial}/percent/state`, state.position], [`easyroll/${state.serial}/position/state`, blind_moving]];
    for (const [i, topic] of Object.entries(topics)) {
        client.publish(topic[0], topic[1], { retain: true });
        log.info(`publish to mqtt: ${topic[0]} = ${topic[1]}`);
    }
}

function mqtt_discovery(state) {
    let cover_topic = `homeassistant/cover/easyroll/${state.serial}/config`;
    let cover_payload = {
        name: `Inoshade-${state.ip.split(':')[0]}`,
        cmd_t: `easyroll/${state.serial}/mode/command`,
        stat_t: `easyroll/${state.serial}/position/state`,
        pos_t: `easyroll/${state.serial}/percent/state`,
        set_pos_t: `easyroll/${state.serial}/percent/command`,
        pos_open: 0,
        pos_clsd: 100,
        uniq_id: `Inoshade-${state.ip.split(':')[0]}`,
        device: {
            ids: `easyroll blind-${state['ip'].split(':')[0]}`,
            name: `easyroll blind-${state['ip'].split(':')[0]}`,
            mf: "Inoshade",
            mdl: "Inoshade-easyroll",
            sw: "harwin1/ha-addons/easyroll_blind",
        }
    }
    mqtt_config_topics.push([cover_topic, cover_payload])

    for (const memory of ['M1', 'M2', 'M3']) {
        let button_topic = `homeassistant/button/easyroll/${state.serial}-${memory.toLowerCase()}/config`;
        let button_payload = {
            name: `Inoshade-${state.ip.split(':')[0]}-${memory}`,
            cmd_t: `easyroll/${state.serial}/${memory.toLowerCase()}/command`,
            uniq_id: `Inoshade-${state.ip.split(':')[0]}-${memory}`,
            device: {
                ids: `easyroll blind-${state['ip'].split(':')[0]}`,
                name: `easyroll blind-${state['ip'].split(':')[0]}`,
                mf: "Inoshade",
                mdl: "Inoshade-easyroll",
                sw: "harwin1/ha-addons/easyroll_blind",
            }
        }
        mqtt_config_topics.push([button_topic, button_payload])
    }

    for (const square of ['SQUAREUP', 'SQUAREDOWN']) {
        square_topic = `homeassistant/button/easyroll/${state['serial']}-${square.toLowerCase()}/config`
        square_payload = {
            name: `Inoshade-${state['ip'].split(':')[0]}-${square}`,
            cmd_t: `easyroll/${state['serial']}/${square.toLowerCase()}/command`,
            uniq_id: `Inoshade-${state['ip'].split(':')[0]}-${square}`,
            device: {
                ids: `easyroll blind-${state['ip'].split(':')[0]}`,
                name: `easyroll blind-${state['ip'].split(':')[0]}`,
                mf: "Inoshade",
                mdl: "Inoshade-easyroll",
                sw: "harwin1/ha-addons/easyroll_blind",
            }
        }
        mqtt_config_topics.push([square_topic, square_payload])
    }

    for (const [topic, payload] of mqtt_config_topics) {
        log.info(`add new blind: ${topic}`)
        client.publish(topic, JSON.stringify(payload), { retain: true })
    }
}

client.on('message', (topic, message) => {
    var topics = topic.split('/');
    var value = message.toString();

    if (topics[0] !== 'easyroll') {
        log.error(`invalid topic prefix: ${topics[0]}`);
        return;
    }
    log.info(`recv. message:  ${topic} = ${value}`)

    if (topics[2] == 'mode') {
        value_array = value;
        blind_command_request(value, 'general');
    } else if (topics[2] == 'percent') {
        blind_command_request(value, 'level');
    } else if ((['squaredown', 'squareup']).includes(topics[2])) {
        blind_command_request(topics[2], 'general');
    } else if ((['m1', 'm2', 'm3']).includes(topics[2])) {
        blind_command_request(topics[2], 'general');
    }
});
