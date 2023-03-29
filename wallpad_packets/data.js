const { SerialPort } = require('serialport')
const net = require('net');
const fs = require('fs');
const OPTIONS = require('/data/options.json');  

// 연결 타입 설정
const connectionType = OPTIONS.connection_type;
const debugMode = OPTIONS.debug_mode;

if (connectionType === 'serial') serialCommunication();
else if (connectionType === 'socket') socketCommunication();
else throw new Error('Invalid connection type');

if (debugMode) {
    console.log('Debug mode enabled packet information is now stored in the', OPTIONS.debug_log.file, 'path');
    if (!fs.existsSync(OPTIONS.debug_log.file)) {
        fs.writeFileSync(OPTIONS.debug_log.file, '');
        console.log('Debug log file created');
    }
}

function serialCommunication() {
    console.log('initializing serial...');

    const port = new SerialPort({
        path: OPTIONS.serial.port,
        baudRate: OPTIONS.serial.baudrate,
        dataBits: OPTIONS.serial.databits,
        parity: OPTIONS.serial.parity,
        stopBits: OPTIONS.serial.stopbits,
        autoOpen: false,
        encoding: 'hex'
    });

    port.on('open', () => {
        console.log('Successfully opened serial port:', port.path);
    });

    port.on('close', () => {
        console.log('Closed serial port:', port.path);
    });

    port.on('error', (err) => {
        console.log('Failed to open serial port:', err.message);
    });

    receiveData(port);
}

function socketCommunication() {
    console.log('initializing socket...');
    const sock = new net.Socket();

    sock.connect(8899, '192.168.1.4', () => {
        console.log('Connected to socket:', sock.remoteAddress + ':' + sock.remotePort);
    });
    
    sock.on('error', (err) => {
        console.log(`Socket connection error: ${err.code}`);
    });

    receiveData(sock);
}

function receiveData(data) {
    data.on('data', (data) => {
        if (!data) {
            throw new Error('Data not found');
        }

        parsePacket(data);
    });
}

function parsePacket(data) {
    let delimiter = '';

    // 구분자 설정
    for (let i = 0; i < data.length - 1; i++) {
        if (data[i] !== data[i + 1]) {
            delimiter = data.slice(0, i + 1);
            break;
        }
    }

    if (!delimiter) {
        console.log('Delimiter not found!');
    }

    const packets = data.toString('hex').split(delimiter.toString('hex'));
    if (debugMode === true) createDebuglog(delimiter.toString('hex') + packets[1]);

    console.log(`Received packets: ${delimiter.toString('hex') + packets[1]}`);
}

function createDebuglog(raw) {
    let writeCount = 0;

    const writeFile = () => {
        const fileName = OPTIONS.debug_log.file + (writeCount > 0 ? writeCount : '');
        fs.appendFile(fileName, raw + '\n', (err) => {
            if (err) throw err;
        });
        writeCount++;
    }

    const writeInterval = setInterval(writeFile, OPTIONS.debug_log.delay * 1000);

    setTimeout(() => {
        clearInterval(writeInterval);
        console.log('Packet data saved to file!');
        if (OPTIONS.debug_save === 'renewal') {
            fs.appendFile(OPTIONS.debug_log.file, '', (err) => {
                if (err) throw err;
                writeFile();
            });
        } else if (OPTIONS.debug_save === 'append') {
            writeFile();
        }
    }, OPTIONS.debug_log.time * 1000);
}
