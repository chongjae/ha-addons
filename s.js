
const V1LOGIN = `http://{}/webapp/data/getLoginWebApp.php?device=WA&login_ide={}&login_pwd={}`;
const V2LOGIN = {
    url: `https://center.hdc-smart.com/v3/auth/login`,
    headers: {
        'Content-Type': 'application/json',
        'Authorization': '{}',
        'User-Agent': ("mozilla/5.0 (windows nt 10.0; win64; x64) applewebkit/537.36 (khtml, like gecko) chrome/78.0.3904.70 safari/537.36")
    }
}

const V1LIST = ['light'];
const V2LIST = ['light', 'elevator'];

const LIGHTSTATUS = {
    url: `http://{}/webapp/data/getHomeDevice.php`,
    headers: {
        'User-Agent': 'Mozilla/5.0',
        'Cookie': `PHPSESSID={}; user_id={}; user_name={}`,
    },
    qs: {
        req_name: 'remote_access_livinglight',
        req_action: 'status',
    },
}

const LIGHTCMD = {
    url: `http://{}/webapp/data/getHomeDevice.php`,
    headers: {
        'accept': 'application/xml',
        'User-Agent': 'Mozilla/5.0',
        'Cookie': `PHPSESSID={}; user_id={}; user_name={}`,
    },
    qs: {
        req_name: 'remote_access_livinglight',
        req_action: 'control',
        req_unit_num: {},
        req_ctrl_action: {},
    },
}

VENTEMPSTR = {
    'low': 01,
    'medium': 02,
    'high': 03,
}

VENTEMPINT = {
    '01': 'low',
    '02': 'medium',
    '03': 'high',
}

export default {
    V1LOGIN, V2LOGIN, V1LIST, V2LIST, LIGHTSTATUS, LIGHTCMD, VENTEMPSTR, VENTEMPINT
}
