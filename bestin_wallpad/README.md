# HDC 베스틴 월패드 RS485 Add-on 
thank chongjae for writing the README

![Supports aarch64 Architecture][aarch64-shield] ![Supports amd64 Architecture][amd64-shield] ![Supports armhf Architecture][armhf-shield] ![Supports armv7 Architecture][armv7-shield] ![Supports i386 Architecture][i386-shield]

# 소개 
* 베스틴 월패드를 사용하는 집에서 사용가능한 애드온 입니다. (월패드 버전 1.0, 2.0).
* MQTT discovery를 이용하여, /통합구성요소/mqtt/기기(bestin_wallpad) 탭에 본인 집 환경에 따라 디바이스가 추가 됩니다.
* 현재 버전에서 추가적인 업데이트는 없습니다. 혹시나 논의가 필요하다면 하단의 지원 부분을 확인 바랍니다.

## 지원 목록
* 해당 기기가 월패드에서 조작및 상태 조회가 가능한 상태여야 합니다.
* 지원 기능
    * 조명
    * 콘센트 (전원, 대기전력차단, 현재전력사용량)
    * 난방
    * 환기 (전열교환기)
    * 가스밸브 (잠금만 지원)
    * 실시간 에너지 사용량 (전기, 난방, 수도, 온수, 가스)
    * REST API
      - Bestin 1.0
        + 거실 조명
      - Bestin 2.0
        + 거실 조명
        + 엘리베이터 호출 및 알림



# 설치
## 1. 준비 사항
### __Hardware__
#### RS485 연결 장치
* Bestin 1.0
  + 게이트웨이 or 월패드 후면에 아래와 같이 RS485 라인에 연결
  ![Bestin 1.0의 게이트웨이](./images/port_1.0.png)




* Bestin 2.0
  * ew11 or usb to rs485 **2개**(에너지컨트롤러 및 미세먼지포트 등)
  * 아래와 같이 포트가 나눠져 있는 경우, 에너지컨트롤러 1개, 미세먼지 포트 1개에 랜선 연결(Lan선을 잘라서 흰파/파 EW11에 연결)
  ![Bestin 2.0의 게이트웨이](./images/port.png)
  ![Bestin 2.0의 게이트웨이](./images/port_connect.png)



* 연결 성공 시, Packet 정보 확인
  * **02**로 시작하는 Packet이 확인되면 **성공**, **BF**로 시작하거나 이상한 Packet이 나온다면 RX/TX **반대**로 체결

***
### __Software__
#### 아이파크 단지 서버 연동
* 아이파크 조명은 릴레이 방식으로 처리 됩니다. 그런 이유로 rs485 패킷으로 거실 조명 제어는 불가능합니다. 아이파크 단지 서버를 연동 하여(부가적인 기능들을 지원합니다.)
#### __Bestin 1.0__
  1. http://www.i-parklife.com 위 주소에서 본인 단지가 있어야 서버 연동이 가능합니다.
  2. 단지 서버 가입이 안되어 있으신 입주민은 먼저 본인 단지 서버ip로 들어가 회원가입을 하신 후 관리사무소에 연락하여 아이디 승인 요청을 받아야 합니다.

#### __Bestin 2.0__
  1. 월패드에서 모바일기기 등록을 누릅니다.
  2. [Google Colab](https://colab.research.google.com/drive/179PCxJUr2HU07SzkSt-z-JTqMbHT1Smv?hl=ko)에 접속합니다.
  3. 위 페이지에는 총 3개의 실행버튼이 좌측에 표시됩니다.
  4. 월패드의 등록창이 활성화된 상태에서 첫번째 버튼을 누릅니다.(UUID는 고유 ID로, 원하는 걸로 변경하세요.)
  5. 월패드에서 6자리 인증번호가 출력되고, 위 페이지에는 코드가 출력됩니다.
  6. 출력된 코드를 transaction에 입력하고, 월패드의 인증번호를 password에 입력합니다.
  7. 두번 째 버튼을 누릅니다.
  8. 마지막으로 세번 째 버튼을 누르면 등록이 성공합니다.
  9. 월패드에서 관리자모드에 진입하여 IP Address를 확인합니다.(10.x.x.x 로 보통 시작합니다)
  <pre><code>
  월패드 관리자모드
  진입방법 : 설정 5초 누르기
  70375968 or 73075968
  설정페이지 : 5968
  </code></pre>

***
### HomeAssistant

* Mosquitto broker 설치
    1. 홈어시스턴트의 Supervisor --> Add-on store에서 Mosquitto broker 선택합니다.
    2. 설치하기를 누른 후 생기는 구성 탭을 누릅니다.
    3. logins: [] 에 원하는 아이디와 비밀번호를 아래와 같은 형식으로 입력합니다. 저장하기를 누르면 자동으로 세 줄로 분리됩니다.
        * logins: [{username: 아이디, password: 비밀번호}]
    5. 정보 탭으로 돌아와 시작하기를 누릅니다.
* MQTT Integration 설치
    1. 홈어시스턴트의 구성하기 --> 통합 구성요소에서 우하단 추가( + ) 를 누른 후 MQTT를 검색하여 선택합니다.
    2. "브로커" 에 HA의 IP주소 입력, "사용자 이름"과 "비밀번호"에 위 Mosquitto의 로그인 정보 입력, "기기 검색 활성화" 후 확인을 누릅니다.
***
### 애드온 설치, 실행

1. 홈어시스턴트의 Supervisor --> Add-on store에서 우상단 메뉴( ⋮ ) 를 누른 후 "repositories" 선택합니다.
2. "Add repository" 영역에 위 주소를 입력한후 추가하기 버튼을 누릅니다. (https://github.com/harwin1/bestin-v1)
3. homeassistant 재부팅 한후 애드온 스토어 하단에 나타난 "HDC BESTIN WallPad RS485 Addon" 을 선택합니다.
4. "INSTALL" 버튼을 누른 후 "START" 가 나타날 때까지 기다립니다. (수 분 이상 걸릴 수 있습니다)
    1. 설치 중 오류가 발생하면 Supervisor -> System 의 System log 최하단을 확인해봐야 합니다.
5. "START" 가 보이면, 시작하기 전에 "Configuration" 페이지에서 아래 설정을 구성 후 "SAVE" 를 누릅니다.
    1. "server_enabled": true/false
    2. 1번 항목을 true로 설정했다면 server_type을 선택 후, "server"에서 적절한 정보를 입력해주세요.
    3. mqtt/broker: 위의 "브로커"와 같은 주소 입력
    4. energy_port/ control_port 항목에서 연결타입(serial, socket) 설정후 각 디바이스에 대한 정보를 적어주세요
       serial-> ser_path, socket-> address, port
6. "Info" 페이지로 돌아와서 "START" 로 시작합니다.
    1. 첫 시작 시 회전 애니메이션이 사라질 때까지 기다려주세요.
7. "Log" 페이지에서 정상 동작하는지 확인합니다.
***
### MQTT 통합 구성요소 설정

* MQTT discovery를 지원하므로, yaml 파일을 구성하지 않아도 됩니다. 단 디버그 등 용도로 구성해야 할 경우에는 위 링크를 참고해보세요
  https://github.com/harwin1/bestin-v1/blob/main/mqtts.yaml  
* 통합 구성요소 페이지에 MQTT가 있고, [ ⋮ ] 를 클릭했을 때 "새로 추가된 구성요소를 활성화" 되어 있어야 합니다.
* MQTT 통합 구성요소에 "bestin_wallpad" 기기가 생성되고 모든 엔티티가 등록됩니다.
***
# 설정

### `server_enable`:
* 단지서버 연동 기능을 활성화/ 비활성화 합니다. true로 설정할 경우 Bestin 1.0, 2.0에 맞는 정보가 필요합니다.

### `server_type`
* 사용하는 Server Type을 고릅니다.(v1 = 1.0, v2 = 2.0)

### `energy / control`
* about
  * energy 또는 control 하나만 연결하는 경우에는 애드온 구성 serial, socket 경우 path, address를 ""로 성정(기본값으로 설정되어 있음)
* type
  * socket(ew11을 이용하는 경우)
  * serial(USB to RS485 혹은 TTL to RS485를 이용하는 경우)
* path(serial type인 경우만 변경)
  * Supervisor -> System -> HARDWARE 버튼을 눌러 serial에 적혀있는 장치 이름을 확인해서 적어주세요.
  * USB to RS485를 쓰신다면 /dev/ttyUSB0, TTL to RS485를 쓰신다면 /dev/ttyAMA0 일 가능성이 높습니다.
  * 단, 윈도우 환경이면 COM6 과 같은 형태의 이름을 가지고 있습니다.
* address / port(socket type인 경우만 변경)
  * EW11의 address와 port 입력

### `server`
* scan_interval
  * 서버에서 상태 정보를 가져오는 주기(단위 second)
  #### __Bestin 1.0__
  * username / password
    * i-parklife의 id/passwd 입력해주세요.
  #### __Bestin 2.0__
  * address
    * 월패드의 IP 입력해주세요.
  * uuid
    * 사전에 등록한 고유 UUID 입력해주세요.

### `mqtt`
* broker
  * MQTT broker (Mosquitto)의 IP를 적어주세요. 일반적으로 HA가 돌고있는 서버의 IP와 같습니다.
* port (기본값: 1883)
  * Mosquitto의 포트 번호를 변경하셨다면 변경한 포트 번호를 적어주세요.
* username, password
  * Mosquitto의 아이디와 비밀번호를 적어주세요.
* prefix
  * MQTT topic의 시작 단어를 변경합니다. 기본값으로 두시면 됩니다.
* discovery (true / false)
  * false로 변경하면 HA에 장치를 자동으로 등록하지 않습니다. 직접 yaml파일 구성이 필요합니다.

### `rs485`
* max_retry (기본값: 20)
* 실행한 명령에 대해서 응답 ack를 받지 못했을 경우 재 명령를 시도할 횟수입니다. 시리얼로 연결했을 경우에는 10번 이내에 명령 성공이지만 ew11 같은 경우 무선 딜레이 경우에 따라 20번으로 동작 안하는 경우가 생길수 있습니다(무선 연결이 튀는경우..등). 이때는 본인 환경에 맞게 조절하면 됩니다.

### `log`
* file
  * true로 설정되어 있으면, '/share/bestin/logs' 경로에 YYYY-MM-DD.log 파일로 저장됩니다. 하루마다 갱신되며 최대 7일치를 저장합니다.
* level
  * log를 저장하는 level을 선택합니다.(silly, info, error, warn)

***
## 지원
[HomeAssistant 네이버 카페 (질문, 수정 제안 등)](https://cafe.naver.com/koreassistant)

[Github issue 페이지 (버그 신고, 수정 제안 등)](https://github.com/harwin1/bestin-v1/issues)

---

[aarch64-shield]: https://img.shields.io/badge/aarch64-yes-green.svg
[amd64-shield]: https://img.shields.io/badge/amd64-yes-green.svg
[armhf-shield]: https://img.shields.io/badge/armhf-yes-green.svg
[armv7-shield]: https://img.shields.io/badge/armv7-yes-green.svg
[i386-shield]: https://img.shields.io/badge/i386-yes-green.svg
