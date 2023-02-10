'use strict';

const EventEmitter = require('events');
const QueuePromise = require('queue-promise');
const request = require('./request');

const ir_guess = require('./ir-guess');

function sleep(msec) {
    return new Promise(resolve => {
        setTimeout(() => resolve() , msec);
    });
}

const LAST_RESPONSE_TIMES_SIZE = 50;

class Irkit extends EventEmitter {
    #ip;
    #get_message_timer;
    #is_sending;
    #queue;
    #poll_interval;
    #min_poll_interval;
    #healthy;
    #irkit_timeout;
    #log;
    #verbose;

    constructor(ip , {poll_interval , irkit_timeout , log , verbose} = {}) {
        super();
        this.#log = log;
        this.#ip = ip;
        this.#is_sending = false;
        this.#verbose = verbose;
        this.#queue = new QueuePromise({
            concurrent : 1 ,
            interval : 200 ,
            start : true ,
        });
        this.#queue.on('start' , () => {
            this.#log('Queue start');
            this.#stop_poll();
        });
        this.#queue.on('end' , () => {
            this.#log('Queue end ; current queue size :' , this.#queue.size);
            this.#start_poll();
        });
        this.#poll_interval = poll_interval ?? 5;
        this.#irkit_timeout = irkit_timeout ?? 20;
        this.#min_poll_interval = this.#poll_interval;
        this.#healthy = true;
        this.#start_poll();
        this.#setup_report_metrics();
    }

    //
    // todo : refactor raw_metrics and report metrics
    //
    #raw_metrics;

    #add_metric(metric_name , metric_value) {
        if ( ! this.#raw_metrics ) {
            this.#raw_metrics = {};
        }
        if ( ! (metric_name in this.#raw_metrics) ) {
            this.#raw_metrics[metric_name] = [];
        }
        this.#raw_metrics[metric_name].push({metric_value , date : Date.now()});
    }

    #add_metric_error() {
        this.#add_metric('errors' , 1);
    }

    #add_metric_response_time(res_time) {
        // this.#log("add res time", res_time);
        this.#add_metric('response_times' , res_time);
    }

    #metrics;

    #setup_report_metrics() {
        if ( ! this.#raw_metrics ) {
            this.#raw_metrics = {};
        }
        setInterval(() => {
            const duration = 10;
            // remove everything older than 10 mins ago
            Object.values(this.#raw_metrics).forEach(arr => {
                const ten_mins_ago = Date.now() - 60 * duration * 1000;
                const ten_mins_ago_idx = arr.findIndex(l => l.date > ten_mins_ago);
                arr.splice(0 , ten_mins_ago_idx);
            });

            if ( ! this.#raw_metrics.response_times )
                this.#raw_metrics.response_times = [];
            if ( ! this.#raw_metrics.errors )
                this.#raw_metrics.errors = [];

            this.#metrics = {
                duration ,
                response_times : {
                    cnt : this.#raw_metrics.response_times.length ,
                    avg : this.#raw_metrics.response_times.length === 0 ? 0 : (
                        this.#raw_metrics.response_times.reduce((accum , cur) => accum + cur.metric_value , 0) /
                        this.#raw_metrics.response_times.length
                    ) ,
                } ,
                errors : {
                    cnt : this.#raw_metrics.errors.length ,
                } ,
            };
            //this.#log("[METRICS] raw", this.#raw_metrics);
            //this.#log("[METRICS] final", this.#metrics);
        } , 60 * 1000);
    }

    get metrics() {
        return this.#metrics ?? {};
    }

    #set_healthy(h) {
        const prev_healthy = this.#healthy;
        this.#healthy = h;
        if ( h !== prev_healthy ) {
            this.emit('health' , h);
        }
    }

    #backoff() {
        this.#poll_interval *= 2;
        if ( this.#poll_interval > 300 ) {
            this.#poll_interval = 300;
        }
    }

    #undo_backoff() {
        this.#poll_interval /= 2;
        if ( this.#poll_interval < this.#min_poll_interval ) {
            this.#poll_interval = this.#min_poll_interval;
        }
    }

    #poll_timer;

    #start_poll() {
        const poll_func = async () => {
            const schedule_next_poll = () => {
                this.#poll_timer = setTimeout(poll_func , this.#poll_interval * 1000);
            };
            if ( this.#queue.shouldRun ) {
                this.#log.warn(`[BUSY] cannot start_poll; send queue is running (size=${this.#queue.size})`);
                return schedule_next_poll();
            }
            try {
                const response = await request(`http://${this.#ip}/messages` , {
                    method : 'get' ,
                    log : this.#verbose ? this.#log : null ,
                    warn : this.#log.warn ,
                });
                const {status , body} = response;
                if ( body ) {
                    this.#set_healthy(true);
                    const message = JSON.parse(response.body);
                    try {
                        const guessed = ir_guess(message?.data);
                        this.emit('message' , {message , guessed});
                    } catch (guess_error) {
                        this.emit('message' , {message});
                    }
                }
                this.#undo_backoff();

                // this.#log.warn(`next poll in ${this.#poll_interval} sec`);
                return schedule_next_poll();
            } catch (error) {
                this.#backoff();
                this.#log.warn('failed to get irkit messages :' , error , `; next poll in ${this.#poll_interval} sec ; error stack :` , error.stack);
                this.#set_healthy(false);
                return schedule_next_poll();
            }
        };
        this.#log(`starting poll in ${this.#poll_interval} sec`);
        if ( ! this.#poll_timer )
            this.#poll_timer = setTimeout(poll_func , this.#poll_interval * 1000);
    }

    #stop_poll() {
        this.#log('stop polling');
        if ( this.#poll_timer ) {
            clearTimeout(this.#poll_timer);
            this.#poll_timer = null;
        }
    }

    stop_and_clear_queue() {
        this.#queue.stop();
        this.#queue.clear();
    }

    get health() {
        return this.#healthy;
    }

    // name of appliance we're current busy dealing with
    #sending_for_appliance_inst;

    #ensure_ready(new_appliance_inst) {
        if ( this.#sending_for_appliance_inst ) {
            if ( this.#sending_for_appliance_inst === new_appliance_inst ) {
                // this.#log.warn(`🐾 clear queue with size ${this.#queue.size}`);
                this.#queue.clear();
                return true;
            } else {
                this.#log.warn(`🐾 enqueue anyway for ${new_appliance_inst.constructor.name}`);
                this.enqueue_callback(() => {
                    this.#log.warn(`🐾 will now process ${new_appliance_inst.constructor.name}, queue size : ${this.#queue.size}`);
                    this.#sending_for_appliance_inst = new_appliance_inst;
                });
                return true;
            }
        } else {
            // this.#log.warn('🐾 start processing queue items for ' + new_appliance_inst.constructor.name);
            this.#sending_for_appliance_inst = new_appliance_inst;
            return true;
        }
    }

    /**
     * enqueues one IrKit data to current send queue
     * @param {object} single
     *      Irkit data {data:[..],mode:"raw",freq:39}
     * @return {Irkit} returns current instance
     */
    enqueue_single(single , appliance_inst) {
        if ( ! this.#ensure_ready(appliance_inst) ) {
            throw new Error('irkit is busy');
        }
        this.#log('enqueue: single' , JSON.stringify(single));
        const send_task = () => this.#post_message(single);
        this.#queue.enqueue(send_task);
        return this;
    }

    /**
     * enqueues multiple tasks (send IrKit data OR sleeps) into the current queue
     * @param {Array} multi
     *      an array containing Irkit data {data:[..],mode:"raw",freq:39} or a sleep {sleep:MSEC_NUMBER}
     * @return {Irkit} returns current instance
     */
    enqueue_multi(multi , appliance_inst) {
        if ( ! this.#ensure_ready(appliance_inst) ) {
            throw new Error('irkit is busy');
        }
        if ( ! Array.isArray(multi) ) {
            throw new TypeError(`expecting multi to be Array instance, got :` + multi);
        }
        for ( const m of multi ) {
            const {sleep} = m;
            if ( sleep ) {
                const sleep_task = () => new Promise(resolve => {
                    this.#log('sleep' , sleep);
                    setTimeout(() => resolve() , sleep);
                });
                this.#log('enqueue: (multi) sleep task' , sleep);
                this.#queue.enqueue(sleep_task);
            } else {
                this.#log('enqueue: (multi) regular task');
                // enqueue regular data
                const send_task = () => this.#post_message(m);
                this.#queue.enqueue(send_task);
            }
        }
        return this;
    }

    /**
     * puts a sleep in the current execution queue
     * @param {number} msec milliseconds to sleep
     * @return {Irkit} returns current instance
     */
    enqueue_sleep(msec) {
        const sleep_task = () => new Promise(resolve => {
            // this.#log("sleep",sleep);
            setTimeout(() => resolve() , sleep);
        });
        this.#log('enqueue: sleep task' , sleep);
        this.#queue.enqueue(sleep_task);
        return this;
    }

    /**
     * puts a callback in the current execution queue, useful when you're sending a series of signals
     * and need to know when all of them has been successfully sent
     * @param {function} cb_function will be called with no arguments
     * @return {Irkit} returns current instance
     */
    enqueue_callback(cb_function) {
        const cb_task = () => {
            return new Promise(resolve => {
                cb_function();
                resolve();
            });
        };
        // this.#log("enqueue: callback");
        this.#queue.enqueue(cb_task);
        return this;
    }

    enqueue_done_callback(cb_function) {
        const cb_task = () => {
            return new Promise(resolve => {
                this.#log(`🐾 finished with ${this.#sending_for_appliance_inst.constructor.name}`);
                this.#sending_for_appliance_inst = null;
                cb_function();
                resolve();
            });
        };
        this.#queue.enqueue(cb_task);
        return this;
    }

    /**
     * a private method to HTTP POST to IrKit. Because the IrKit doesn't handle consecutive/large traffic
     * properly, this method should not be directly called; instead, call the enqueue_XXX methods
     * @param {object} payload content to be converted to JSON
     * @param {number} timeout in seconds; if timeout tthe returned Promise will be rejected
     * @param {number} retry max retries to run, before sleeping 1 sec
     * @return {Promise}
     */
    async #post_message(payload , timeout = 5 , retry = 5) {
        const do_post = (url , payload , timeout = 5) => {
            return new Promise(async (resolve , reject) => {
                try {
                    const start_msec = Date.now();
                    const opts = {
                        method : 'post' ,
                        cache : 'no-cache' ,
                        body : JSON.stringify(payload) ,
                    };
                    const res = await request(url , opts);
                    const {status} = res;
                    this.#log('📮 post completed in' , Date.now() - start_msec , 'msec, status=' , status);
                    this.#set_healthy(true);
                    return resolve(res);
                } catch (error) {
                    this.#set_healthy(false);
                    this.#log.error('📮 post error :' , error);
                    return reject({error});
                }
            });
        };
        // this.#log("irkit post_message", JSON.stringify(payload));
        this.#is_sending = true;
        let attempt = 0;
        let wait_delay = 3;
        while (true) {
            try {
                const response = await do_post(`http://${this.#ip}/messages` , payload , timeout);
                this.#is_sending = false;
                return {done : response?.status === 200};
            } catch (error) {
                this.#log.warn('📮🔥 failed to post irkit messages :' + JSON.stringify(error));
                if ( retry && attempt < retry ) {
                    attempt++;
                    this.#log.warn('will retry' , attempt , '/' , retry , '; wait [sec]' , wait_delay);
                    await sleep(wait_delay * 1000);
                    wait_delay *= 2;
                    continue;
                } else {
                    this.#is_sending = false;
                    return {error};
                }
            }
        }
    }

    static is_irkit(ip , {log , warn} = {}) {
        return new Promise(async (resolve , reject) => {
            try {
                const response = await request(`http://${ip}/` , {
                    method : 'get' ,
                    allow_http_statuses : [404] ,
                    log ,
                    warn ,
                });
                if ( (response.headers?.server ?? '').match(/^IRKit\//) ) {
                    return resolve(true);
                } else {
                    return resolve(false);
                }
            } catch (error) {
                return reject({error});
            }
        });
    }
}

module.exports = Irkit;
