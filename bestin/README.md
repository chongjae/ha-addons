# Hass.io Add-on: Bestin Wallpad Controller with RS485 

![Supports aarch64 Architecture][aarch64-shield] ![Supports amd64 Architecture][amd64-shield] ![Supports armhf Architecture][armhf-shield] ![Supports armv7 Architecture][armv7-shield] ![Supports i386 Architecture][i386-shield]

## About
HAKorea 님의 addons 저장소를 참고하여 작성하였습니다.
체크섬 공식을 이용하여 동적패킷을 생성하여 온도설정과 엘리베이터 호출을 지원합니다.
엘리베이터 활성화 시에는 게이트웨이 스마트 포트를 Y커플러 통해서 분배해야 합니다.
설치 방법-> 
https://yogyui.tistory.com/entry/%EA%B4%91%EA%B5%90%EC%95%84%EC%9D%B4%ED%8C%8C%ED%81%AC-%EC%97%98%EB%A6%AC%EB%B2%A0%EC%9D%B4%ED%84%B0-%ED%99%88%ED%82%B7-%EC%97%B0%EB%8F%99-1-2

## Version : 1.3.0

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
sendDelay: 80 
maxRetry: 20

type:
'serial' or 'socket'

serial:
  serName: /dev/ttyUSB0 or COM0
socket:
  address: 192.168.0.x
  port: 8899
  
mqtt:
  server: 192.168.x.x
  username: id
  password: pw
  port: 1883
  receiveDelay: 5000
  prefix: homenet
```
<# 에너지 포트, 컨트롤포트 각각 독립적으로 연결을 지원합니다. 예를 들어 에너지 포트는 시리얼, 컨트롤 포트는 소켓으로 구성할 수 있습니다.>
<엘리베이터 구성시에 가급적 시리얼 통신을 권장합니다. timestamp값을 통한 엘리베이트 호출이므로 딜레이가 없는 시리얼 통신이 확율이 좋습니다.>
### Option: `sendDelay, gapDelay, retryCount` (필수)
sendDelay-> 실제 패킷을 전송하는 딜레이를 의미합니다. (ms)
maxRetry-> 설정한 횟수만큼 명령을 시도합니다.(ack(응답) 메시지가 오지 않는 경우 방지)

### Option: `type` (필수)
통신 방법: serial 또는 socket 

### Option: `serial` (옵션)
type: serial 로 설정한 경우 아래 옵션 사용
```yaml
   serName: /dev/ttyUSB0 or COM0
```
socket을 사용하는 경우 위 값은 무시합니다.

### Option: `socket` (옵션) 
type: socket 로 설정한 경우 아래 옵션 사용
```yaml
  address: 192.0.x.x   // elfin과 같은 wifi to RS485 기기의 ip 주소
  port: 8899     // elfin과 같은 wifi to RS485 기기의 port 주소
```

### Option `MQTT` (필수)
```yaml
  broker: 192.168.x.xx  // MQTT 서버
  username: id          // MQTT ID
  password: pw          // MQTT PW
  receivedelay: 5000	// 전송후 메시지 수신 지연 시간 1/1000초 단위
  prefix: homenet     // MQTT TOPIC 선두 이름정의(자유롭게 이름 설정 가능) '"homenet"/Light1/power1/command'-> 'bestin/Light1/power1/command'
```

## Support

궁금한 점이 있으신가요??

아래에 문의 하시면 답변을 구하실 수 있습니다.:

- The [Hass.io Add-on: bestinRS485][github].
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
