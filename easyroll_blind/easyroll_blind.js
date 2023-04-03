/**
 * Easyroll Blind MQTT Bridge
 * @author harwin1
 */

const request = require('request');
const mqtt = require('mqtt');
const Options = require('./config.json').options;

const address_array = [];
let mqtt_discovery = false;
let previousState = {};
let value_array;
for (let i = 0; i < Options.blind_connection; i++) {
    var address = Options.server['address' + (i + 1)];
    if (address == '') {
        console.log('INFO     Not Found address' + (i + 1) + ' in config.json');
        break;
    } else {
        console.log('INFO     Found address' + (i + 1) + ' in config.json');
        address_array.push(address);
    }
}

const state_url = `http://{}:20318/lstinfo`;
const action_url = `http://{}:20318/action`;

const command_parameter = {
    'OPEN': 'TU',
    'CLOSE': 'BD',
    'STOP': 'SS'
};
 
const client = mqtt.connect(`mqtt://${Options.mqtt.broker}`, {
    port: Options.mqtt.port,
    username: Options.mqtt.username,
    password: Options.mqtt.password,
    clientId: 'easyroll_blind',
})
console.log('INFO     Initializing mqtt...');

client.on('connect', () => {
    console.log('INFO     MQTT connection successful!');
    client.subscribe('Inoshade/+/+/command', (err) => {
        if (err) console.log(`ERROR    Failed to subscribe to ${topic}`);
    });
})

client.on('error', (err) => {
    console.log(`INFO     MQTT connection error: ${err}`);
});

client.on('reconnect', () => {
    console.log('INFO     MQTT connection lost. try to reconnect...');
});

function stateRequest() {
    for (const [index, address] of Object.entries(address_array)) {
        request.get(state_url.replace('{}', address),
            function (error, response, body) {
                const state = JSON.parse(body);

                if (error || state.result != 'success') {
                    const err = [error, state.result];
                    console.log(`INFO     Easyroll Blind state error: ${err}`);
                    return;
                }

                if (response.statusCode == 200 && state.result == 'success') {
                    console.log(`INFO     Easyroll Blind state request success: ${state.serial_number}:${state.local_ip}`);
                    console.log(`INFO     Easyroll Blind update to position: ${Math.floor(state.position)}%`);

                    const result = {
                        serial: state.serial_number,
                        ip: state.local_ip,
                        position: String(Math.floor(state.position))
                    };
                    publishState(result);
                }
            });
    }
}
function setInterval(socn, func) {
    func();

    return setTimeout(function () { setInterval(socn, func); }, socn);
}

const Interval = Options.scan_interval * 1000;
setInterval(Interval, stateRequest);

function actionRequest(value, type) {
    for (const [index, address] of Object.entries(address_array)) {
        const generalOp = {
            url: action_url.replace('{}', address),
            headers: {
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                "mode": "general",
                "command": command_parameter[value]
            })
        };
        const levelOp = {
            url: action_url.replace('{}', address),
            headers: {
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                "mode": "level",
                "command": value
            }) 
        }
        request.post(type == 'generalOp' ? generalOp : levelOp, function (error, response, body) {
            const state = JSON.parse(body);

            if (error || state.result != 'success') {
                const err = [error, state.result];
                console.log(`ERROR    Easyroll Blind state error: ${err}`);
                return;
            }

            if (response.statusCode == 200 && state.result == 'success') {
                console.log(`INFO     Easyroll Blind command[${value}] request success!`);
            }
        });
    }
}

function publishState(state) {
    var position;
    if (state.position == 100) {
        position = 'closed';
    } else if (state.position < 100 && !['OPEN', 'CLOSE', 'STOP'].includes(value_array)) {
        position = 'open';
    } else if (value_array == 'CLOSE') {
        position = 'closing';
    } else if (value_array == 'OPEN') {
        position = 'opening';
    } else if (value_array == 'STOP') {
        position = 'stopped';
    }

    if (previousState.serial === state.serial && previousState.position === state.position) { 
        //console.log(`Skipping publish to ${topic} because position hasn't changed.`);
        return;
    }

    if (previousState = '{}') {
        previousState = state;
    }
    discovery(state);

    const topics = [[`Inoshade/${state.serial}/percent/state`, state.position], [`Inoshade/${state.serial}/position/state`, position]];
    for (const [index, topic] of Object.entries(topics)) { 
        if (mqtt_discovery !== true) { 
            console.log(`INFO     Waiting.. MQTT Connected`)
            return;
        }

        client.publish(topic[0], topic[1], { retain: true });
        console.log(`INFO     Publish to MQTT: ${topic[0]} = ${topic[1]}`);
    }
}

function discovery(state) {
    var topic = `homeassistant/cover/Inoshade/${state.serial}/config`;
    var payload = {
        name: `Inoshade-${state.ip.split(':')[0]}`,
        cmd_t: `Inoshade/${state.serial}/mode/command`,
        stat_t: `Inoshade/${state.serial}/position/state`,
        pos_t: `Inoshade/${state.serial}/percent/state`,
        set_pos_t: `Inoshade/${state.serial}/percent/command`,
        pos_open: 0,
        pos_clsd: 100,
        uniq_id: `Inoshade-${state.ip.split(':')[0]}`,
        device: {
            ids: "easyroll_blind",
            name: "easyroll_blind",
            mf: "Inoshade",
            mdl: "Inoshade-easyroll",
            sw: "harwin1/ha-addons/easyroll_blind",
        }
    }

    if (mqtt_discovery == false) {
        console.log(`INFO     Add new easyroll-blind: ${topic}`);

        client.publish(topic, JSON.stringify(payload), { retain: true });
        mqtt_discovery = true;
    } else {
        console.log(`WARNING  Failed to add new easyroll-blind: ${topic}`);
        setTimeout(() => { mqtt_discovery = false, console.log(`INFO     Retrying.. Add easyroll blind: ${topic}`) }, 5000);
    }
}

client.on('message', (topic, message) => {
    var topics = topic.split('/');
    var value = message.toString(); 

    if (topics[0] !== 'Inoshade') {
        console.log(`ERROR    Invalid topic prefix: ${topics[0]}`);
        return;
    } 

    if (topics[2] == 'mode') {
        value_array = value;
        console.log(`INFO     Easyroll Blind general command: ${topics[1]}::${value}`);

        actionRequest(value, 'generalOp');
    } else if (topics[2] == 'percent') {
        console.log(`INFO     Easyroll Blind level command: ${topics[1]}::${value}%`);

        actionRequest(value, 'levelOp');
    }
});
