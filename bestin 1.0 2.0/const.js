const CONFIG = require('./config.json').options;

const { address, username, password, uuid } = CONFIG.server;

const V1LOGIN = `http://${address}/webapp/data/getLoginWebApp.php?device=WA&login_ide=${username}&login_pwd=${password}`;
const V2LOGIN = {
    url: `https://center.hdc-smart.com/v3/auth/login`,
    headers: {
        'content-type': 'application/json',
        'authorization': uuid,
        'user-agent': ("mozilla/5.0 (windows nt 10.0; win64; x64) applewebkit/537.36 (khtml, like gecko) chrome/78.0.3904.70 safari/537.36")
    }
}

const V1LIGHTSTATUS = {
    url: `http://${address}/webapp/data/getHomeDevice.php`,
    headers: {
        'user-agent': 'Mozilla/5.0',
        'cookie': `PHPSESSID={0}; user_id={1}; user_name={2}`,
    },
    qs: {
        req_name: 'remote_access_livinglight',
        req_action: 'status',
    },
}

const V2LIGHTSTATUS = {
    url: `{0}/v2/api/features/livinglight/1/apply`,
    headers: {
        'User-Agent': 'Mozilla/5.0',
        'access-token': '{1}' 
    }
}

const V2EVSTATUS = 'https://{0}/v2/admin/elevators/sse?lastEventId='

const V2HDCLOGIN = {
    url: 'https://iwsn3.hdc-smart.com/api/auth/login',
    body: JSON.stringify({ 'name': `${username}`, 'password': `${password}` }), // 요청 페이로드
    headers: {
        'content-type': 'application/json',
        'user-agent': ("mozilla/5.0 (windows nt 10.0; win64; x64) applewebkit/537.36 (khtml, like gecko) chrome/78.0.3904.70 safari/537.36")
    }
}

const V1LIGHTCMD = {
    url: `http://${address}/webapp/data/getHomeDevice.php`,
    method: 'GET',
    headers: {
        'accept': 'application/xml',
        'user-agent': 'Mozilla/5.0',
        'cookie': `PHPSESSID={0}; user_id={1}; user_name={2}`,
    },
    qs: {
        req_name: 'remote_access_livinglight',
        req_action: 'control',
        req_unit_num: '{3}',
        req_ctrl_action: '{4}',
    },
}

const V2LIGHTCMD = {
    url: `{0}/v2/api/features/livinglight/{1}/apply`,
    method: 'PUT',
    body: JSON.stringify({ 'unit': `{2}`, 'state': `{3}` }), // 요청 페이로드
    headers: {
        'access-token': '{4}',
        'accept': 'application/json',
        'user-agent': 'Mozilla/5.0',
    },
}

const V2ELEVATORCMD = {
    url: `{0}/v2/admin/elevators/home/apply`,
    method: 'POST',
    body: JSON.stringify({ 'address': `${address}`, 'direction': 'down' }), 
    headers: {
        'content-type': 'application/json',
        'authorization': uuid,
        'user-agent': ("mozilla/5.0 (windows nt 10.0; win64; x64) applewebkit/537.36 (khtml, like gecko) chrome/78.0.3904.70 safari/537.36")
    },
}

VENTEMPSTR = {
    'low': 01,
    'medium': 02,
    'high': 03,
}

VENTEMPINT = {
    01: 'low',
    02: 'medium',
    03: 'high',
}

module.exports = {
    V1LOGIN,
    V2LOGIN,
    V1LIGHTSTATUS,
    V2LIGHTSTATUS,
    V1LIGHTCMD,
    V2HDCLOGIN,
    V2EVSTATUS,
    V2ELEVATORCMD,
    V2LIGHTCMD,
    VENTEMPSTR,
    VENTEMPINT
}