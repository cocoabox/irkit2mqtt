/**
 * mqtt-client
 *
 * 2023-02-02   .. added logging facilities : this.log
 *
 */
'use strict';
const EventEmitter = require('events');
const Queue = require('queue-promise');
const mqtt = require('mqtt');
const json5 = require('json5');
const path = require('path');
const mqtt_match = require('mqtt-match');
const chalk = require('chalk');

const Config = require('./config');

function sleep(msec) {
    return new Promise(resolve => {
        setTimeout(() => resolve() , msec);
    });
}

class MqttClient extends EventEmitter {
    #conf;
    #queue;
    #client;
    #subscribed_topics;
    #message_type;

    constructor(conf_path , {connect_on_construct , message_type} = {}) {
        super();
        this.#setup_log();
        this.#conf = typeof conf_path === 'string'
            ? Config.from_path(conf_path)
            : Config.from_data(conf_path , __dirname);

        if ( ! ['json' , 'buffer' , 'string' , 'auto'].includes(message_type) ) {
            throw new Error(`invalid message_type : ${message_type}`);
        }
        this.#message_type = message_type;
        // so each mqtt message is sequentially sent
        this.#queue = new Queue({
            concurrent : 1 ,
            interval : 300 ,
            start : true ,
        });
        this.#subscribed_topics = [];
        if ( connect_on_construct ) {
            this.log('connecting');
            this.mqtt_connect();
        }
    }

    get config() {
        return this.#conf.data ?? {};
    }

    /**
     * type {function}
     */
    #log;
    #console;

    #setup_log() {
        const caller_length = 25;
        this.#console = new console.Console({stdout : process.stdout , stderr : process.stderr});
        const log_func = (log_type , console_method , args) => {
            const stack = (new Error).stack;
            const line2 = stack.replace(/^Error/ , '').trim().split('\n').map(n => n.trim())[2];
            const caller = line2?.match(/^at (.*?) \([^\(]+\)/)?.[1];
            const src_line_number = (() => {
                const mat = line2.match(/^at (.*?):([0-9]+)/);
                const filename = mat?.[1] ? path.basename(mat?.[1]) : 'unknown';
                return `${filename}:${mat?.[2]}`;
            })();
            const final_caller = (! caller
            || caller === 'Timeout._onTimeout'
            || caller.match(/(\.<anonymous>|\[as _onTimeout\])$/) ? src_line_number : caller).trim();
            const final_caller_padded = final_caller + ' '.repeat((() => {
                const len = caller_length - final_caller.length;
                return len > 0 ? len : 0;
            })());
            this.#console[console_method].apply(this ,
                [].concat([(new Date).toLocaleString() , `[${log_type}] ${final_caller_padded} :`] , args));
        };
        this.#log = (...args) => {
            log_func('LOG' , 'log' , args);
        };
        this.#log.log = this.#log;
        this.#log.info = (...args) => {
            const color = 'blue';
            log_func(chalk[color]('INFO') , 'log' , args.map(a => typeof a === 'string' ? chalk[color](a) : a));
        };
        this.#log.warn = (...args) => {
            const color = 'yellow';
            log_func(chalk[color]('WARN') , 'warn' , args.map(a => typeof a === 'string' ? chalk[color](a) : a));
        };
        this.#log.error = (...args) => {
            const color = 'red';
            log_func(chalk[color]('ERROR') , 'error' , args.map(a => typeof a === 'string' ? chalk[color](a) : a));
        };
    }

    get log() {
        return this.#log;
    }

    get mqtt_connected() {
        return !! this.#client?.connected;
    }

    async #ensure_connect(timeout_sec) {
        if ( this.mqtt_connected ) return;
        const timeout_timer = timeout_sec ? setTimeout(() => {
            throw {error : 'timeout'};
        } , timeout_sec * 1000) : null;
        this.log('waiting for connection');
        while (true) {
            sleep(1000);
            if ( this.mqtt_connected ) {
                clearTimeout(timeout_timer);
                return;
            }
        }
    }

    #want_close;
    #reconnect_timer;

    mqtt_connect() {
        return new Promise(resolve => {
            if ( this.#client ) {
                // this.log('[mqtt] connect using prev opts');
                // re-established a severed connection
                if ( this.#client.connected ) {
                    this.log('[mqtt] 🔌 already connected');
                    return;
                }
                this.log('[mqtt] 🔌 reconnecting');
                this.#client.reconnect();
                return;
            }
            // brand new connection
            const mqtt_conf = this.#conf.data?.mqtt;
            if ( ! mqtt_conf ) {
                throw new Error('🔥 mqtt configuration is empty');
            }
            const connect_opts = Object.assign({} ,
                {
                    connectTimeout : mqtt_conf?.connect_timeout || 30 * 1000 ,
                    protocol : mqtt_conf.cert ? 'mqtts' : 'mqtt' ,
                    host : mqtt_conf.host ,
                    port : mqtt_conf.port ,
                    reconnectPeriod : 5000 , // reconnect in 5 seconds
                } ,
                mqtt_conf.username ? {username : mqtt_conf.username} : {} ,
                mqtt_conf.password ? {password : mqtt_conf.password} : {} ,
                mqtt_conf.cert ? {
                    cert : mqtt_conf.cert ,
                    rejectUnauthorized : true ,
                } : {} ,
                mqtt_conf.ca ? {ca : mqtt_conf.ca} : {} ,
                mqtt_conf.key ? {key : mqtt_conf.key} : {} ,
            );
            this.log('[mqtt] fresh connection to :' , connect_opts.host , 'port' , connect_opts.port);
            this.#client = mqtt.connect(connect_opts);
            this.#client.on('connect' , () => {
                // this.log('[mqtt] connected');
                if ( this.#subscribed_topics && this.#subscribed_topics.length > 0 )
                    this.#client.subscribe(this.#subscribed_topics , (err , granted) => {
                        this.log('[mqtt] subscription granted=' , granted , '; err=' , err);
                    });
                this.emit('mqtt-connect');
                resolve();

            });
            this.#client.on('close' , () => {
                if ( this.#want_close ) {
                    this.#want_close = false; // debounce this flag
                    this.log('[mqtt] 🔌 connection closed on request');
                    this.emit('mqtt-close');
                } else {
                    this.#start_reconnect_timer();
                }
                this.emit('mqtt-close');
            });
            this.#client.on('message' , (topic , message_buffer) => {
                // this.log("Incoming :", topic, message_buffer.toString('utf8'));
                this.#internal_mqtt_on_message(topic , message_buffer);
            });
        });
    }

    #start_reconnect_timer() {
        const reconnect_sec = 5;
        this.log(`[mqtt]🔌  will reconnect in ${reconnect_sec} sec`);
        setTimeout(() => {
            this.log(`[mqtt] 🔌 reconnect timer time's up`);
            this.mqtt_connect();
        } , reconnect_sec * 1000);
    }

    mqtt_close({force}) {
        this.#want_close = true;
        return new Promise(resolve => {
            if ( ! this.#client ) return resolve();
            this.#client.end(!! force , {} , () => {
                resolve();
            });
        });
    }

    mqtt_unsubscribe(topic) {
        if ( this.#client?.connected ) {
            this.#client.unsubscribe(topic);
        }
        this.#subscribed_topics.splice(
            this.#subscribed_topics.indexOf(topic) , 1);
        return this;
    }

    mqtt_subscribe(topic_or_topics) {
        if ( ! topic_or_topics || topic_or_topics?.length === 0 ) return;
        if ( this.#client?.connected ) {
            this.#client.subscribe(topic_or_topics , (err , granted) => {
                this.log('[mqtt] subscription granted=' , granted , '; err=' , err);
            });
        }
        this.#subscribed_topics = [].concat(this.#subscribed_topics ,
            Array.isArray(topic_or_topics) ? topic_or_topics : [topic_or_topics]);
        return this;
    }

    #incoming_topic_patterns;
    set incoming_topic_patterns(regex) {
        const regex_arr = Array.isArray(regex) ? regex : [regex];
        this.#incoming_topic_patterns = regex_arr;
    }

    get incoming_topic_patterns() {
        return this.#incoming_topic_patterns;
    }

    /**
     * @param {string} topic
     * @param {Buffer} message_buffer
     */
    #internal_mqtt_on_message(topic , message_buffer) {
        if ( Array.isArray(this.#incoming_topic_patterns)
            && this.#incoming_topic_patterns.filter(pattern => mqtt_match(pattern , topic)).length === 0
        ) {
            return;
        }
        switch (this.#message_type.toLowerCase()) {
            case 'buffer':
                return this.mqtt_on_message(topic , message_buffer);
            case 'string':
                return this.mqtt_on_message(topic , message_buffer.toString('utf8'));
            case 'json':
                return json5.parse(this.mqtt_on_message(topic , message_buffer.toString('utf8')));
            case 'auto':
            default:
                // try to decode JSON, if fail then pass Buffer
                try {
                    const str = message_buffer.toString('utf8');
                    if ( str === 'null' || typeof str === 'undefined' || str === '' ) {
                        return this.mqtt_on_message(topic);
                    } else {
                        const parsed = json5.parse(str);
                        return this.mqtt_on_message(topic , parsed);
                    }
                } catch (error) {
                    return this.mqtt_on_message(topic , message_buffer);
                }
        }
    }

    mqtt_on_message(topic , message) {
        // child classes should implement this  method
    }

    #throttle_next_sendable_time;
    #throttle_cooldown_time_sec;
    set throttle_cooldown_time_sec(val) {
        this.#throttle_cooldown_time_sec = val;
    }

    #throttle_should_drop(topic) {
        if ( ! this.#throttle_next_sendable_time ) {
            this.#throttle_next_sendable_time = {};
        }
        const next_sendable_time = this.#throttle_next_sendable_time[topic];
        if ( typeof next_sendable_time === 'number'
            && Date.now() < next_sendable_time ) {
            return {next_sendable_time};
        }
    }

    #throttle_mark_sent(topic) {
        if ( ! this.#throttle_next_sendable_time ) {
            this.#throttle_next_sendable_time = {};
        }
        this.#throttle_next_sendable_time[topic] = Date.now() +
            (this.#throttle_cooldown_time_sec * 1000);
    }

    /**
     * @protected
     */
    mqtt_publish(topic , body , {publish_opts , wait_connect_timeout , wait_msec_after} = {}) {
        const message = body instanceof Buffer ? body
            : typeof body === 'object' ? JSON.stringify(body)
                : typeof body === 'undefined' ? ''
                    : `${body}`;
        const message_buf = Buffer.from(message ?? '');
        if ( this.config?.verbose ) {
            this.log('mqtt publish :' , topic , '; body :' , body);
        }

        return new Promise(async (finally_resolve , finally_reject) => {
            const throttle_reason = this.#throttle_should_drop(topic);
            if ( throttle_reason ) {
                this.log.warn('🚮 [throttle] topic' , topic , 'is sent too often ;' , throttle_reason);
                return finally_resolve({throttled : 1});
            } else {
                // don't drop
                // this.log.warn('🚮 [throttle] OK to send', topic);
                this.#throttle_mark_sent(topic);
            }
            try {

                await this.#ensure_connect(wait_connect_timeout ?? 10);
            } catch (error) {
                this.log.warn(`could not mqtt_publish "${topic}" because timed out while waiting for connection`);
                finally_reject({timeout : 1});
            }
            const publish_task = () => new Promise((resolve , reject) => {
                // this.log('[mqtt] publish :', topic);
                this.#client.publish(topic , message_buf , publish_opts ?? {} , async (err) => {
                    if ( wait_msec_after ) {
                        await sleep(wait_msec_after);
                    }
                    resolve();
                    finally_resolve();
                });
            });
            this.#queue.enqueue(publish_task);
        });


    }
}

module.exports = MqttClient;
