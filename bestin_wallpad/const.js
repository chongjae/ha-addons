const { address, username, password, uuid } = require('/data/options.json').server;

const V1LOGIN = `http://${address}/webapp/data/getLoginWebApp.php?device=WA&login_ide=${username}&login_pwd=${password}`;
const V2LOGIN = {
    url: 'https://center.hdc-smart.com/v3/auth/login',
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
        'cookie': 'PHPSESSID={0}; user_id={1}; user_name={2}'
    },
    qs: {
        req_name: 'remote_access_livinglight',
        req_action: 'status'
    },
}

const V2LIGHTSTATUS = {
    url: '{0}/v2/api/features/livinglight/1/apply',
    headers: {
        'User-Agent': 'Mozilla/5.0',
        'access-token': '{1}'
    }
}

const V2EVSTATUS = {
    hostname: '{0}',
    path: '/v2/admin/elevators/sse?lastEventId=',
    method: 'GET'
}
const EVSTATE = { 'moveinfo': '이동중', 'arrived': '도착' }

const V1LIGHTCMD = {
    url: `http://${address}/webapp/data/getHomeDevice.php`,
    method: 'GET',
    headers: {
        'accept': 'application/xml',
        'user-agent': 'Mozilla/5.0',
        'cookie': 'PHPSESSID={0}; user_id={1}; user_name={2}'
    },
    qs: {
        req_name: 'remote_access_livinglight',
        req_action: 'control',
        req_unit_num: '{3}',
        req_ctrl_action: '{4}'
    },
}

const V2LIGHTCMD = {
    url: '{0}/v2/api/features/livinglight/{1}/apply',
    method: 'PUT',
    body: JSON.stringify({ 'unit': '{2}', 'state': '{3}' }), // 요청 페이로드
    headers: {
        'access-token': '{4}',
        'accept': 'application/json',
        'user-agent': 'Mozilla/5.0'
    },
}

const V2ELEVATORCMD = {
    url: '{0}/v2/admin/elevators/home/apply',
    method: 'POST',
    body: JSON.stringify({ 'address': `${address}`, 'direction': 'down' }),
    headers: {
        'content-type': 'application/json',
        'authorization': uuid,
        'user-agent': ("mozilla/5.0 (windows nt 10.0; win64; x64) applewebkit/537.36 (khtml, like gecko) chrome/78.0.3904.70 safari/537.36")
    },
}

const VENTTEMP = {
    'low': 0x01,
    'medium': 0x02,
    'high': 0x03
}
const VENTTEMPI = {
    0x01: 'low',
    0x02: 'medium',
    0x03: 'high'
}

const ONOFFDEV = {
    'gas': 'off',
    'doorlock': 'on',
    'lightbatch': 'on'
}

const DISCOVERY_DEVICE = {
    'ids': ['bestin_wallpad'],
    'name': 'bestin_wallpad',
    'mf': "HDC BESTIN",
    'mdl': "Bestin Wallpad",
    'sw': "harwin1/ha-addons/bestin_wallpad",
};

const DISCOVERY_PAYLOAD = {
    light: [{
        _intg: 'light',
        name: '{0}_light_{1}_{2}',
        cmd_t: '{0}/light/{1}/{2}/command',
        stat_t: '{0}/light/{1}/{2}/state',
        pl_on: 'on',
        pl_off: 'off',
    }],
    outlet: [{
        _intg: 'switch',
        name: '{0}_outlet_{1}_{2}',
        cmd_t: '{0}/outlet/{1}/power{2}/command',
        stat_t: '{0}/outlet/{1}/power{2}/state',
        pl_on: 'on',
        pl_off: 'off',
        icon: 'mdi:power-socket-eu'
    },
    {
        _intg: 'switch',
        name: '{0}_outlet_{1}_standby',
        cmd_t: '{0}/outlet/{1}/standby/command',
        stat_t: '{0}/outlet/{1}/standby/state',
        pl_on: 'on',
        pl_off: 'off',
        icon: 'mdi:power-socket-eu'
    },
    {
        _intg: 'sensor',
        name: '{0}_power_{1}_{2}',
        stat_t: '{0}/outlet/{1}/usage{2}/state',
        unit_of_meas: 'W',
        icon: 'mdi:lightning-bolt'
    },
    {
        _intg: 'switch',
        name: '{0}_outlet_{1}_all',
        cmd_t: '{0}/outlet/{1}/all/command',
        stat_t: '{0}/outlet/{1}/all/state',
        pl_on: 'on',
        pl_off: 'off',
        icon: 'mdi:power-socket-eu'
    }],
    gas: [{
        _intg: 'switch',
        name: '{0}_gas_cutoff',
        cmd_t: '{0}/gas/{1}/cutoff/command',
        stat_t: '{0}/gas/{1}/cutoff/state',
        pl_on: 'on',
        pl_off: 'off',
        icon: 'mdi:gas-cylinder'
    },
    {
        _intg: 'sensor',
        name: '{0}_gas_valve',
        stat_t: '{0}/gas/{1}/power/state',
    }],
    fan: [{
        _intg: 'fan',
        name: '{0}_fan',
        cmd_t: '{0}/fan/{1}/power/command',
        stat_t: '{0}/fan/{1}/power/state',
        pr_mode_cmd_t: '{0}/fan/{1}/preset/command',
        pr_mode_stat_t: '{0}/fan/{1}/preset/state',
        pr_modes: ['low', 'medium', 'high', 'nature'],
        pl_on: 'on',
        pl_off: 'off',
    }],
    thermostat: [{
        _intg: 'climate',
        name: '{0}_thermostat_{1}',
        mode_cmd_t: '{0}/thermostat/{1}/power/command',
        mode_stat_t: '{0}/thermostat/{1}/power/state',
        temp_cmd_t: '{0}/thermostat/{1}/target/command',
        temp_stat_t: '{0}/thermostat/{1}/target/state',
        curr_temp_t: '{0}/thermostat/{1}/current/state',
        modes: ['off', 'heat'],
        min_temp: 5,
        max_temp: 40,
        temp_step: 0.5,
    }],
    energy: [{
        _intg: 'sensor',
        name: '{0}_{1}_{2}usage',
        stat_t: '{0}/energy/{1}/{2}/state',
        unit_of_meas: '-'
    }],
    doorlock: [{
        _intg: 'switch',
        name: '{0}_doorlock',
        cmd_t: '{0}/doorlock/{1}/power/command',
        stat_t: '{0}/doorlock/{1}/power/state',
        pl_on: 'on',
        pl_off: 'off',
        icon: 'mdi:lock'
    }],
    elevator: [{
        _intg: 'switch',
        name: '{0}_elevator',
        cmd_t: '{0}/elevator/{1}/call/command',
        stat_t: '{0}/elevator/{1}/call/state',
        pl_on: 'on',
        pl_off: 'off',
        icon: 'mdi:elevator'
    },
    {
        _intg: 'sensor',
        name: '{0}_evdirection',
        stat_t: '{0}/elevator/{1}/direction/state',
        icon: 'mdi:elevator'
    },
    {
        _intg: 'sensor',
        name: '{0}_evstate',
        stat_t: '{0}/elevator/{1}/floor/state',
        icon: 'mdi:elevator'
    }]
};

module.exports = {
    V1LOGIN,
    V2LOGIN,
    V1LIGHTSTATUS,
    V2LIGHTSTATUS,
    V2EVSTATUS,
    V1LIGHTCMD,
    V2LIGHTCMD,
    V2ELEVATORCMD,
    EVSTATE,
    VENTTEMP,
    VENTTEMPI,
    ONOFFDEV,
    DISCOVERY_DEVICE,
    DISCOVERY_PAYLOAD
};
