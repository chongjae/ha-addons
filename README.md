# Hass.io Add-on: Bestin Wallpad Controller with RS485 

![Supports aarch64 Architecture][aarch64-shield] ![Supports amd64 Architecture][amd64-shield] ![Supports armhf Architecture][armhf-shield] ![Supports armv7 Architecture][armv7-shield] ![Supports i386 Architecture][i386-shield]

## About
HAKorea 님의 addons 저장소를 참고하여 작성하였습니다.

## Version : 2022.11.20

## Installation

1. 홈어시스턴트의 Hass.io > ADD-ON STORE에서 Add new repository by URL에 https://github.com/harwin1/bestinRS485 를 입력한 다음 ADD 버튼을 누릅니다.
2. ADD-ON STORE 페이지 하단에서 "Kocom Wallpad Controller with RS485" 클릭합니다.
3. "INSTALL" 버튼을 누르면 애드온이 설치됩니다. 최대 약 10분 정도 소요. 
4. INSTALL 버튼위에 설치 애니메이션이 동작하는데 이것이 멈추더라도 REBUILD, START 버튼이 나타나지 않는 경우가 있습니다.
5. 이 애드온은 이미지를 내려받는 것이 아니라 직접 여러분의 Hassio에서 이미지를 만듭니다. 따라서 컴퓨터성능과 인터넷 속도에 따라서 시간이 좀 걸립니다. 
6. INSTALL 버튼을 누른다음 설치 애니메이션이 실행되면 제대로 설치중인 것입니다. INSTALL을 여러번 누르지 마시고 기다리다 지치면 브라우저 페이지를 리프리시 하세요. 
7. 애드온 페이지에서 Config을 본인의 환경에 맞게 수정합니다.
8. "START" 버튼으로 애드온을 실행합니다.

만일 bestin.js 파일을 수정하시려면 한번 실행한 후 애드온을 Stop 하시고 share/bestin/ 폴더에 있는 파일을 알맞게 수정하신 다음 애드온을 Start 하시면 이후부터는 수정된 파일을 적용합니다.

## Configuration

Add-on configuration:

```yaml
sendDelay: 80 (ms)
gapDelay: 30 (ms)

energy_type:
serial or socket
energy_header:
Serial or Socket
control_type:
serial or socket
control_header:
Serial or Socket

energy_serial:
  rpiPort: /dev/ttyUSB0
  windowPort: COM0
  baudrate: 9600
  bytesize: 8
  parity: none
  stopbits: 1
energy_socket:
  addr: 192.0.0.1
  port: 8899
control_serial:
  rpiPort: /dev/ttyUSB0
  windowPort: COM0
  baudrate: 9600
  bytesize: 8
  parity: none
  stopbits: 1
control_socket:
  addr: 192.0.0.1
  port: 8899
  
mqtt:
  server: 192.168.x.x
  username: id
  password: pw
  receiveDelay: 5000
  prefix: homenet
```
### Option: `type` (필수)
통신 방법: serial 또는 socket 

### Option: `header` (필수)
위에서 선택한 타입 정의 Serial 또는 Socket

### Option: `serial` (옵션)
type: serial 로 설정한 경우 아래 옵션 사용

```yaml
  rpiPort: /dev/ttyUSB0  // 라즈베리파이 포트명
  windowPort: COM0    // 윈도우 포트명
  baudrate: 9600      // 시리얼 통신 속도
  bytesize: 8
  parity : none       // 패리티 체크 (none, even, odd 중 한 값)
  stopbits: 1
```
socket을 사용하는 경우 위 값은 무시합니다.

### Option: `socket` (옵션) 
type: socket 로 설정한 경우 아래 옵션 사용
```yaml
  addr: 192.0.x.x   // elfin과 같은 wifi to RS485 기기의 ip 주소
  port: 8899            // elfin과 같은 wifi to RS485 기기의 port 주소
```

### Option `MQTT` (필수)
```yaml
  server: 192.168.x.xx  // MQTT 서버
  username: id          // MQTT ID
  password: pw          // MQTT PW
  receivedelay: 5000	// 전송후 메시지 수신 지연 시간 1/1000초 단위
  prefix: homenet     // MQTT TOPIC 선두 이름정의(자유롭게 이름 설정 가능) '"homenet"/Light1/power1/command'-> 'bestin/Light1/power1/command'
```

## Support

궁금한 점이 있으신가요??

아래에 문의 하시면 답변을 구하실 수 있습니다.:

- The [Home Assistant Korean Community][github].
- The [Home Assistant 네이버카페][forum].

버그신고는 카페나 깃허브로 해주세요 [open an issue on our GitHub][issue].

[forum]: https://cafe.naver.com/koreassistant
[github]: https://github.com/harwin1/bestinRS485
[issue]: https://github.com/harwin1/bestinRS485/issues
[aarch64-shield]: https://img.shields.io/badge/aarch64-yes-green.svg
[amd64-shield]: https://img.shields.io/badge/amd64-yes-green.svg
[armhf-shield]: https://img.shields.io/badge/armhf-yes-green.svg
[armv7-shield]: https://img.shields.io/badge/armv7-yes-green.svg
[i386-shield]: https://img.shields.io/badge/i386-yes-green.svg
