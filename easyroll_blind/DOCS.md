# Home Assistant Add-on: EasyRoll Smart Blind

## Installation

Follow these steps to get the add-on installed on your system:

1. Navigate in your Home Assistant frontend to **Settings** -> **Add-ons** -> **Add-on store**.
2. Find the "EasyRoll Smart Blind" add-on and click it.
3. Click on the "INSTALL" button.

## How to use

The add-on has a couple of options available. To get the add-on running:

1. Start the add-on.
2. Have some patience and wait a couple of minutes.
3. Check the add-on log output to see the result.

## Configuration

Add-on configuration:

```yaml
blinds: []
mqtts: []
scan_interval: 300
command_interval: 30
```

### Option: `blinds` (optional)

Enter addresses for easy roll blinds you want to connect to Type "- 'ip address'" as many blinds as you want

```yaml
blinds:
  - 192.168.1.1
  - 192.168.x.x....
  - ....
```

### Option: `mqtts` (optional)

Enter mqtt broker information Required *server *port / username, password is optional and fits your broker information

```yaml
mqtts:
  - server: 192.168.1.1
    port: 1883
    username: user
    password: passwd
```

#### Option: `scan_interval(unit. minute)`

Blind query status lookup interval. Gets the blind status every [scan_interval] interval.

Default value: `300`

#### Option: `command_interval(unit. second)`

Status activation time after blind command manipulation. Polling and updating continuously by [command_interval].

Default value: `30`

## Support

Got questions?

You have several options to get them answered:

- The Home Assistant [NAVER Cafe][forum].

In case you've found a bug, please [open an issue on our GitHub][issue].

[forum]: https://cafe.naver.com/koreassistant
[issue]: https://github.com/harwin1/ha-addons/issues
[repository]: https://github.com/harwin1/ha-addons
