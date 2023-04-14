import requests
import paho.mqtt.client as paho_mqtt
import logging
import json

import time
import threading

options_file = open('/data/options.json',)
options = json.load(options_file)

logger = logging.getLogger(__name__)

mqtt_connected = False
mqtt_config_topics = []
mqtt = paho_mqtt.Client()

address_array = []
previous_state = {}
value_array = None


def init_logger():
    logger.setLevel(logging.INFO)

    formatter = logging.Formatter(
        fmt="%(asctime)s %(levelname)-8s %(message)s", datefmt="%H:%M:%S")
    handler = logging.StreamHandler()
    handler.setFormatter(formatter)
    logger.addHandler(handler)


for i in range(options['blind_connection']):
    address = options['server']['address' + str(i+1)]
    if address == '':
        logger.info('not found address{} in config.json'.format(i+1))
        break
    else:
        logger.info('found address{} in config.json'.format(i+1))
        address_array.append(address)

state_url = 'http://{}:20318/lstinfo'
action_url = 'http://{}:20318/action'

command_parameter = {
    'OPEN': 'TU',  # 최상단 올림
    'CLOSE': 'BD',  # 최하단 내림
    'STOP': 'SS',  # 정지
    'SQUAREUP': 'SU',  # 한 칸 올림
    'SQUAREDOWN': 'SD'  # 한 칸 내림
}


def start_mqtt_loop():
    logger.info("initializing mqtt...")

    mqtt.on_message = mqtt_on_message
    mqtt.on_connect = mqtt_on_connect
    mqtt.on_disconnect = mqtt_on_disconnect

    if options["mqtt"]["login"]:
        mqtt.username_pw_set(
            options["mqtt"]["username"], options["mqtt"]["password"])

    try:
        mqtt.connect(options["mqtt"]["broker"], options["mqtt"]["port"])
    except Exception as e:
        raise AssertionError(
            "MQTT server address/port may be incorrect! ({})".format(str(e)))

    mqtt.loop_start()

    delay = 1
    while not mqtt_connected:
        logger.info("waiting mqtt connected...")
        time.sleep(delay)
        delay = min(delay * 2, 10)


def mqtt_on_connect(mqtt, userdata, flags, rc):
    if rc == 0:
        logger.info("MQTT connect successful!")
        global mqtt_connected
        mqtt_connected = True
    else:
        logger.error('MQTT connection error: {}'.format(rc))

    topic = 'easyroll/+/+/command'
    logger.info("subscribe: {}".format(topic))
    mqtt.subscribe(topic, 0)


def mqtt_on_disconnect(mqtt, userdata, rc):
    logger.warning("MQTT disconnected! ({})".format(rc))
    global mqtt_connected
    mqtt_connected = False


def mqtt_on_message(mqtt, userdata, msg):
    topics = msg.topic.split("/")
    payload = msg.payload.decode()

    if topics[0] != 'easyroll':
        logger.error("Invalid topic prefix: {}".format(topics[0]))
        return

    logger.info("recv. message:  {} = {}".format(msg.topic, payload))

    if topics[2] == 'mode':
        value_array = payload
        blind_command_request(payload, 'general')
    elif topics[2] == 'percent':
        blind_command_request(payload, 'level')
    elif topics[2] in ['SQUAREUP', 'SQUAREDOWN']:
        blind_command_request(payload, 'general')
    elif topics[2] in ['M1', 'M2', 'M3']:
        blind_command_request(payload, 'general')


def updata_blind_position():
    for i, address in enumerate(address_array):
        url = state_url.format(address)
        response = requests.get(url)
        state = response.json()

        if response.status_code == 200 and state['result'] == 'success':
            logger.info('easyroll blind state request success: {}::{}'.format(
                state['serial_number'], state['local_ip'].split(":")[0]))
            logger.info('easyroll blind update to position: {}%'.format(
                int(state['position'])))
            blind_information = {
                "serial": state['serial_number'].lower(),
                "ip": state['local_ip'].split(":")[0],
                "position": str(int(state['position']))
            }
            parse_blind_value(blind_information)
    threading.Timer(options['scan_interval'], updata_blind_position).start()


def parse_blind_value(state):
    global previous_state, value_array

    if state['position'] == '100':
        blind_moving = 'closed'
    elif state['position'] < '100' and value_array not in ['OPEN', 'CLOSE', 'STOP']:
        blind_moving = 'open'
    elif value_array == 'CLOSE':
        blind_moving = 'closing'
    elif value_array == 'OPEN':
        blind_moving = 'opening'
    elif value_array == 'STOP':
        blind_moving = 'stopped'

    if previous_state == {}:
        previous_state = state
    elif previous_state['serial'] == state['serial'] and previous_state['position'] == state['position']:
        return

    previous_state = state
    mqtt_discovery(state)
    mqtt_publish(state, blind_moving)


def mqtt_publish(state, blind_moving):
    topics = [
        (f"easyroll/{state['serial']}/percent/state", state['position']),
        (f"easyroll/{state['serial']}/position/state", blind_moving)
    ]

    for topic in topics:
        mqtt.publish(topic[0], topic[1], retain=True)
        logger.info('publish to mqtt: {} = {}'.format(topic[0], topic[1]))


def mqtt_discovery(state):
    cover_topic = f"homeassistant/cover/easyroll/{state['serial']}/config"
    cover_payload = {
        "name": f"Inoshade-{state['ip'].split(':')[0]}",
        "cmd_t": f"easyroll/{state['serial']}/mode/command",
        "stat_t": f"easyroll/{state['serial']}/position/state",
        "pos_t": f"easyroll/{state['serial']}/percent/state",
        "set_pos_t": f"easyroll/{state['serial']}/percent/command",
        "pos_open": 0,
        "pos_clsd": 100,
        "uniq_id": f"Inoshade-{state['ip'].split(':')[0]}",
        "device": {
            "ids": f"easyroll blind-{state['ip'].split(':')[0]}",
            "name": f"easyroll blind-{state['ip'].split(':')[0]}",
            "mf": "Inoshade",
            "mdl": "Inoshade-easyroll",
            "sw": "harwin1/ha-addons/easyroll_blind",
        }
    }
    mqtt_config_topics.append([cover_topic, cover_payload])

    for memory in ['M1', 'M2', 'M3']:
        button_topic = f"homeassistant/button/easyroll/{state['serial']}-{memory.lower()}/config"
        button_payload = {
            "name": f"Inoshade-{state['ip'].split(':')[0]}-{memory}",
            "cmd_t": f"easyroll/{state['serial']}/{memory.lower()}/command",
            "uniq_id": f"Inoshade-{state['ip'].split(':')[0]}-{memory}",
            "device": {
                "ids": f"easyroll blind-{state['ip'].split(':')[0]}",
                "name": f"easyroll blind-{state['ip'].split(':')[0]}",
                "mf": "Inoshade",
                "mdl": "Inoshade-easyroll",
                "sw": "harwin1/ha-addons/easyroll_blind",
            }
        }
        mqtt_config_topics.append([button_topic, button_payload])

    for square in ['SQUAREUP', 'SQUAREDOWN']:
        square_topic = f"homeassistant/button/easyroll/{state['serial']}-{square.lower()}/config"
        square_payload = {
            "name": f"Inoshade-{state['ip'].split(':')[0]}-{square}",
            "cmd_t": f"easyroll/{state['serial']}/{square.lower()}/command",
            "uniq_id": f"Inoshade-{state['ip'].split(':')[0]}-{square}",
            "device": {
                "ids": f"easyroll blind-{state['ip'].split(':')[0]}",
                "name": f"easyroll blind-{state['ip'].split(':')[0]}",
                "mf": "Inoshade",
                "mdl": "Inoshade-easyroll",
                "sw": "harwin1/ha-addons/easyroll_blind",
            }
        }
        mqtt_config_topics.append([square_topic, square_payload])

    for topic, payload in mqtt_config_topics:
        logger.info('add new blind: {}'.format(topic))
        mqtt.publish(topic, json.dumps(payload), retain=True)


def blind_command_request(value, option_type):
    for i, address in enumerate(address_array):
        if option_type == 'general':
            body = {
                "mode": "general",
                "command": command_parameter[value]
            }
        else:
            body = {
                "mode": "level",
                "command": value
            }
        headers = {'content-type': 'application/json'}
        url = action_url.format(address)
        response = requests.post(url, headers=headers, json=body)
        state = response.json()

        if response.status_code == 200 and state['result'] == 'success':
            logger.info(
                'easyroll blind command[{}] request success!'.format(value))


if __name__ == '__main__':
    init_logger()
    start_mqtt_loop()
    updata_blind_position()
