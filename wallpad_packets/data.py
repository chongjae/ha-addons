import serial
import socket
import json
import os
import time

import logging

logger = logging.getLogger(__name__)

with open('/data/options.json') as config_file:
    OPTIONS = json.load(config_file)

KOCOM_DEVICE = {
    "00": "MAIN",
    "01": "MAIN",
    "0e": "LIGHT",
    "2c": "GAS",
    "33": "DOORLOCK",
    "36": "THERMOSTAT",
    "39": "AC",
    "3b": "OUTLET",
    "44": "EV",
    "48": "FAN",
    "60": "MOTION",
}

BESTIN_DEVICE = {}

WALLPAD_PREFIX = {
    "aa55": [KOCOM_DEVICE, [14, 16]],
}

# 연결 타입 설정
connection_type = OPTIONS['connection_type']
debug_mode = OPTIONS['debug_mode']


def init_logger():
    logger.setLevel(logging.INFO)

    formatter = logging.Formatter(
        fmt="%(asctime)s %(levelname)-8s %(message)s", datefmt="%H:%M:%S")
    handler = logging.StreamHandler()
    handler.setFormatter(formatter)
    logger.addHandler(handler)

'''
if debug_mode:
    logger.warning(
        f"Debug mode enabled packet information is now stored in the {OPTIONS['debug_log']['file']} path")
    if not os.path.exists(OPTIONS['debug_log']['file']):
        open(OPTIONS['debug_log']['file'], 'w').close()
        logger.info('Debug log file created')
'''

def serial_communication():
    logger.info('initializing serial...')
    port = serial.Serial(
        port=OPTIONS['serial']['port'],
        baudrate=OPTIONS['serial']['baudrate'],
        bytesize=OPTIONS['serial']['databits'],
        parity=OPTIONS['serial']['parity'],
        stopbits=OPTIONS['serial']['stopbits'],
        timeout=None,
        encoding='hex',
    )

    if port.isOpen():
        logger.info(f"Successfully opened serial port: {port.portstr}")

    receive_data(port)


def socket_communication():
    sock_address = OPTIONS['socket']['address']
    sock_port = OPTIONS['socket']['port']

    logger.info('initializing socket...')
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.connect((sock_address, sock_port))
    logger.info(f"Connected to socket: {sock_address}:{sock_port}")

    receive_data(sock)


def receive_data(data_stream):
    while True:
        data = data_stream.recv(1024)
        if not data:
            raise ValueError('Data not found')
        parse_packet(data)


def parse_packet(packet_data):
    delimiter = b''

    # 구분자 설정
    for i in range(len(packet_data) - 1):
        if packet_data[i] != packet_data[i + 1]:
            delimiter = packet_data[:i + 1]
            break

    if not delimiter:
        logger.warning('Delimiter not found!')
        return

    delimiter_hex = delimiter.hex()
    packet_suffix = packet_data.hex().split(delimiter_hex)[1]
    packet = delimiter_hex + packet_suffix

    #if debug_mode:
    #    create_debug_log(packet)

    for prefix, prefix_info in WALLPAD_PREFIX.items():
        if prefix.encode() in prefix.encode() and OPTIONS['wallpad_device']:
            device = prefix_info[0][packet[prefix_info[1]
                                           [0]: prefix_info[1][1]]]
            if device is not None:
                logger.info("{}[{}]".format(packet, device))
            else:
                logger.info("{}[Unknown: 0x{}]".format(
                    packet, packet[prefix_info[1][0]: prefix_info[1][1]]))
        else:
            logger.info(packet)

''' file storage bug needs to be fixed
def create_debug_log(raw_packet):
    write_count = 0

    def write_file():
        nonlocal write_count

        file_path = OPTIONS["debug_log"]["file"]
        if write_count > 0:
            file_path += str(write_count)
        with open(file_path, "a") as f:
            f.write(raw_packet + "\n")
        write_count += 1

    if debug_mode:
        logger.warning(
            f"Debug mode enabled, packet information is now stored in the {OPTIONS['debug_log']['file']} file")

        if not os.path.exists(OPTIONS["debug_log"]["file"]):
            open(OPTIONS["debug_log"]["file"], "a").close()
            logger.info("Debug log file created")

        write_interval = OPTIONS["debug_log"]["delay"]
        write_interval = write_interval if write_interval else 1

        total_write_time = OPTIONS["debug_log"]["time"]
        total_write_time = total_write_time if total_write_time else 60

        start_time = time.time()
        while True:
            current_time = time.time()
            if current_time - start_time >= total_write_time:
                break
            write_file()
            time.sleep(write_interval)

        logger.warning("Packet data saved to file!")
        if OPTIONS["debug_save"] == "renewal":
            open(OPTIONS["debug_log"]["file"], "w").close()
            write_file()
        elif OPTIONS["debug_save"] == "append":
            write_file()
'''


if __name__ == '__main__':

    init_logger()

    if connection_type == 'serial':
        serial_communication()
    elif connection_type == 'socket':
        socket_communication()
    else:
        raise ValueError('Invalid connection type')
