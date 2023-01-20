const EventEmitter = require("events");
const Queue = require('queue-promise');
const mqtt = require('mqtt');
const json5 = require('json5');

const Config = require('./config');

function sleep(msec) {
    return new Promise(resolve => {
        setTimeout(() => resolve(), msec);
    });
}

class MqttClient extends EventEmitter {
    #conf;
    #queue;
    #client;
    #subscribed_topics;
    #message_type;
    constructor(conf_path, {connect_on_construct,message_type}={}) {
        super();
        this.#conf = Config.from_path(conf_path);
        if (! ['json', 'buffer', 'string', 'auto'].includes(message_type)) {
            throw new Error(`invalid message_type : ${message_type}`);
        }
        this.#message_type = message_type;
        // so each mqtt message is sequentially sent
        this.#queue =  new Queue({
            concurrent: 1,
            interval: 300,
            start: true,
        });
        this.#subscribed_topics = [];
        if (connect_on_construct) {
            console.log("connecting");
            this.mqtt_connect();
        }
    }
    get config() {
        return this.#conf.data ?? {};
    }
    get mqtt_connected() {
        return !! this.#client?.connected;
    }
    async #ensure_connect(timeout_sec) {
        if (this.mqtt_connected) return;
        const timeout_timer = timeout_sec ? setTimeout(() => {
            throw {error:'timeout'};
        }, timeout_sec * 1000) : null;
        console.log("waiting for connection");
        while(true) {
            sleep(1000);
            if (this.mqtt_connected) {
                clearTimeout(timeout_timer);
                return;
            }
        }
    }
    mqtt_connect() {
        return new Promise(resolve => {
            if (this.#client) {
                // console.log('[mqtt] connect using prev opts');
                // re-established a severed connection
                if (this.#client.connected) return;
                this.#client.reconnect();
                return;
            }
            // brand new connection 
            const mqtt_conf = this.#conf.data?.mqtt;
            if (! mqtt_conf) {
                throw new Error('🔥 mqtt configuration is empty');
            }
            const connect_opts = Object.assign({}, 
                {
                    connectTimeout: mqtt_conf?.connect_timeout || 30 * 1000,
                    protocol: mqtt_conf.cert ? 'mqtts': 'mqtt',
                    host: mqtt_conf.host,
                    port: mqtt_conf.port,
                    reconnectPeriod: 5000, // reconnect in 5 seconds
                },
                mqtt_conf.username ? { username : mqtt_conf.username } : {},
                mqtt_conf.password ? { password : mqtt_conf.password } : {},
                mqtt_conf.cert ? { 
                    cert : mqtt_conf.cert,
                    rejectUnauthorized: true,
                } : {},
                mqtt_conf.ca ? { ca : mqtt_conf.ca } : {},
                mqtt_conf.key ? { key : mqtt_conf.key } : {},
            );
            // console.log('[mqtt] fresh connection to :' , connect_opts.host,'port',connect_opts.port);
            this.#client = mqtt.connect(connect_opts);
            this.#client.on('connect', () => {
                // console.log('[mqtt] connected');
                this.#client.subscribe(this.#subscribed_topics, (err, granted) => {
                    // console.log('[mqtt] subscription granted=', granted,'; err=', err);
                });
                this.emit('mqtt-connect');
                resolve();

            });
            this.#client.on('close', () => {
                console.log('[mqtt] closed');
                this.emit('mqtt-close');
            });
            this.#client.on('message', (topic, message_buffer) => {
                // console.log("Incoming :", topic, message_buffer.toString('utf8'));
                this.#internal_mqtt_on_message(topic, message_buffer);
            });
        });
    }
    mqtt_close({force}) {
        return new Promise(resolve => {
            if (! this.#client) return resolve();
            this.#client.end(!! force, {}, () => {
                resolve();
            });
        });
    }

    mqtt_unsubscribe(topic) {
        if (this.#client?.connected) {
            this.#client.unsubscribe(topic);
        }
        this.#subscribed_topics.splice(
            this.#subscribed_topics.indexOf(topic), 1);
        return this;
    }
    mqtt_subscribe(topic_or_topics) {
        if (this.#client?.connected) {
            this.#client.subscribe(topic_or_topics, (err, granted) => {
                // console.log('[mqtt] subscription granted=', granted,'; err=', err);
            });
        }
        if (Array.isArray(topic_or_topics)) {
            this.#subscribed_topics = [].concat(this.#subscribed_topics, topic_or_topics);
        }
        else {
            this.#subscribed_topics.push(topic_or_topics);
        }
        return this;
    }
    #incoming_topic_pattern;
    set incoming_topic_pattern(regex) {
        if (! (regex instanceof RegExp)) {
            throw new TypeRror('expecting regex to be instance of RegExp, got :' + regex);
        }
        this.#incoming_topic_pattern = regex;
    }
    get incoming_topic_pattern() {
        return this.#incoming_topic_pattern;
    }
    #internal_mqtt_on_message(topic, message_buffer) {
        if (this.#incoming_topic_pattern && ! topic.match(this.#incoming_topic_pattern)) {
            return;
        }
        switch(this.#message_type.toLowerCase()) {
            case 'buffer': return this.mqtt_on_message(topic, message_buffer);
            case 'string': return this.mqtt_on_message(topic, message_buffer.toString('utf8'));
            case 'json': return json5.parse(this.mqtt_on_message(topic, message_buffer.toString('utf8')));
            case 'auto':
            default:
                // try to decode JSON, if fail then pass Buffer
                try {
                    const str = message_buffer.toString('utf8');
                    if (str === 'null' || typeof str === 'undefined' || str === '') {
                        return this.mqtt_on_message(topic);
                    }
                    else {
                        const parsed = json5.parse(str);
                        return this.mqtt_on_message(topic, parsed);
                    }
                }
                catch (error) {
                    return this.mqtt_on_message(topic, message_buffer);
                }
        }
    }
    mqtt_on_message(topic, message) {
        // child classes should implement this  method
    }
    #throttle_next_sendable_time;
    #throttle_cooldown_time_sec;
    set throttle_cooldown_time_sec(val) {
        this.#throttle_cooldown_time_sec = val;
    }
    #throttle_should_drop(topic) {
        if (! this.#throttle_next_sendable_time) {
            this.#throttle_next_sendable_time = {};
        }
        const next_sendable_time = this.#throttle_next_sendable_time[topic];
        return typeof next_sendable_time === 'number'
            && Date.now() < next_sendable_time;
    }
    #throttle_mark_sent(topic) {
        if (! this.#throttle_next_sendable_time) {
            this.#throttle_next_sendable_time = {};
        }
        this.#throttle_next_sendable_time[topic] = Date.now() + 
            (this.#throttle_cooldown_time_sec * 1000);
    }

    /**
     * @protected
     */
    mqtt_publish(topic, body, {publish_opts,wait_connect_timeout,wait_msec_after}={}) {
        const message = body instanceof Buffer ? body 
            : typeof body === 'object' ? JSON.stringify(body)
            : typeof body === 'undefined' ? '' 
            : `${body}`;
        const message_buf = Buffer.from(message ?? '');

        return new Promise(async (finally_resolve, finally_reject) => {
            if (this.#throttle_should_drop(topic)) {
                console.warn('🚮 [throttle] this message is being sent too often and will be dropped', topic);
                return finally_resolve({throttled:1});
            }
            else {
                // don't drop
                // console.warn('🚮 [throttle] OK to send', topic);
                this.#throttle_mark_sent(topic);
            }
            try {

                await this.#ensure_connect( wait_connect_timeout ?? 10 );
            }
            catch (error) {
                console.warn(`could not mqtt_publish "${topic}" because timed out while waiting for connection`);
                finally_reject({timeout:1});
            }
            const publish_task = () => new Promise((resolve, reject) => {
                // console.log('[mqtt] publish :', topic);
                this.#client.publish(topic, message_buf, publish_opts ?? {}, async (err) => {
                    if (wait_msec_after) {
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
