INSTALLING
===========

1. run `npm i`

1. create `conf/irkit2mqtt.json5` (use [conf-sample](conf-sample) as a reference)

1. copy or symlink cert files to `conf/certs/*`, adding all references to above conf json file

1. enter path of log file to `conf/log-location.txt` (to omit logging, or log to syslog, skip this step)

1. run `install-service.sh` to enable systemd service and start running


MQTT MESSAGES
==============

Default mesage prefix is :`irkit2mqtt`

## published topic `irkit2mqtt/__irkit__/{IRKIT_NAME}/message`

message body : JSON 
  
| field | format | meaning | example |
| ----- | ------ | ------- | ------- | 
| `.message` | `object` | raw message received by IRKit | `{"format":"raw", "freq":38, "data": [ 1000, 1000, ... ]}` |
| `.message.raw` | `string` | IRKit constant `"raw"` | |
| `.message.freq` | `number` | IRKit constant `38` | |
| `.message.data` | `number[]` | Infrared pulses in μsec | |
| `.guessed` | `object` | guessed IRKit transmission, may be absent. | `{"format":"nec","T":625,"frames":[[1,1,1,0,0,..],"repeat"]}` |
| `.guessed.format` | `string` | guessed format, should be `aeha`, `nec` or `sony` | |
| `.guessed.T` | `number` | guessed T value of the transmission; see : [赤外線リモコンの通信フォーマット](http://elm-chan.org/docs/ir_format.html) | `625` |
| `.guessed.frames` | `Array[]` | transmission fames | | 
| `.guessed.frames.[]` | `{number|sring}[]` or `string` | guessed bits, for unknown bits a `'?'` would be in place; a repeat is denoted by `"repeat"` | |
 
example 

```
{"message":{"format":"raw","freq":38,"data":[19991,10047,1275,3704,1275,3704,1275,3704,1275,1275,1275,1275,1275,3704,1275,3704,1275,3704,1275,1275,1275,1275,1275,3704,1275,3704,1275,1275,1275,1275,1275,1275,1275,1275,1275,1275,1275,1275,1275,3704,1275,1275,1275,1275,1275,1275,1275,1275,1275,3704,1275,3704,1275,3704,1275,1275,1275,3704,1275,3704,1275,3704,1275,3704,1275,1275,1275]},"guessed":{"format":"nec","T":625,"frames":[[1,1,1,0,0,1,1,1,0,0,1,1,0,0,0,0,0,0,1,0,0,0,0,1,1,1,0,1,1,1,1,0]]}}
```

## published topic `irkit2mqtt/{APPLIANCE_NAME}`

Published whenever the appliance state has been updated via Irkit2mqtt

message body : JSON

| field | format | meaning | example |
| ----- | ------ | ------- | ------- | 
| `.model` | `string` | appliance model name, corresponds to your configuration setting | `"toshiba-frc205t"` |
| `.appliance_type` | `string` | appliance type provided by plugin | `"light"` |
| `.state` | `object` | current state of the appliance; this object may not have all values if it's never been set (we don't know who else has operated on the appliance); it might be an empty object `{}` at startup. | `{"mode":"off"}` |

example

```
{"model":"toshiba-frc205t","appliance_type":"light","state":{"mode":"off","brightness":0}}
```

## subscribed topic `irkit2mqtt/{APPLIANCE_NAME}/set`

send a message on this topic to update an appliance's state. The message body should be valid JSON5 or JSON.

example

```
{mode:"normal", brightness:10}
```

## subscribed topic `irkit2mqtt/{APPLIANCE_NAME}/do/{ACTION_NAME}`

Send a message on this topic to perform a quick action on an appliance. Depending on the appliance this may cause a state udpate.

Message body should be empty.


## published topic `irkit2mqtt/{APPLIANCE_NAME}/ex/{EX_FIELD_NAME}`

Published when an "ex" field is updated.

<details><summary> about "ex" fields</summary>

An "ex" field is a field that's separated from the intrinsic appliance states. 

Some platforms such as Home Assistant mqtt, require very specific mqtt topic formats, for example [MQTT HVAC](https://www.home-assistant.io/integrations/climate.mqtt/) 
requires that the air-conditioner's operating mode to be published using a separate topic, however irkit2mqtt appliances only publish an overall JSON state.
To overcome this, a separate class of plugins called "mqtt-rewrite" plugins are written to translate internal appliance states to individual topics, performing 
value/unit conversions where necessary.

For details see 'plugins.'

</summary>

Message body depends on the field. Usually it is plain value e.g. `unquoted string` or `plain number`.

## subscribed topic `irkit2mqtt/{APPLIANCE_NAME}/ex/{EX_FIELD_NAME}/set`

Send a message to this topic to update its internal states. This is reserved for platforms like Home Assistant mqtt.


Plugins 
========

TBD
