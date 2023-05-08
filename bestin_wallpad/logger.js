const winston = require('winston');
const CONFIG = require('/data/options.json');

const { file, level } = CONFIG.log;
const { combine, timestamp, printf } = winston.format;

const logLevel = level || 'silly';
                        // default

// 로그 출력 포맷
const format = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(
        (info) => `${info.timestamp} ${info.level.toUpperCase()}: ${info.message}`,
    ),
)

// 파일 저장 설정
const fileTransport = new winston.transports.File({
    filename: `./logs/${new Date().toISOString().slice(0, 10)}.log`,
    maxFiles: 7,
    maxsize: 1024 * 1024 * 10,
    tailable: true,
});

// 로그 레벨별 설정
const logger = winston.createLogger({
    level: logLevel,
    format: combine(timestamp(), format),
    transports: [
        new winston.transports.Console(),
    ],
});

// log_file이 true일 때 파일 저장 설정 추가
if (file) {
    logger.add(fileTransport);
}

// 로그 레벨에 따른 파일 저장 설정
switch (level) {
    case 'silly':
        fileTransport.level = 'silly';
    case 'info':
        fileTransport.level = 'info';
        break;
    case 'error':
        fileTransport.level = 'error';
        break;
    case 'warn':
        fileTransport.level = 'warn';
        break;
}

module.exports = logger;

