"use strict";

const EventEmitter = require("events");
const axios = require('axios');
const QueuePromise = require('queue-promise');
const ir_guess = require('./ir-guess');

axios.defaults.headers.common = {};
axios.defaults.headers.post = {};

function sleep(msec) {
    return new Promise(resolve => {
        setTimeout(() => resolve(), msec);
    });
}

class Irkit extends EventEmitter {
    #ip;
    #get_message_timer;
    #is_sending;
    #queue;
    #poll_interval;
    #min_poll_interval;
    #healthy;
    constructor(ip, {poll_interval} = {}) {
        super();
        this.#ip = ip;
        this.#is_sending = false;
        this.#queue = new QueuePromise({
            concurrent: 1,
            interval: 200,
            start: true,
        });
        this.#poll_interval = poll_interval ?? 5;
        this.#min_poll_interval = this.#poll_interval;
        this.#healthy= true;
        this.#start_poll();
    }
    #set_healthy(h) {
        const prev_healthy = this.#healthy;
        this.#healthy = h;
        if (h !== prev_healthy) {
            this.emit('health', h);
        }
    }
    #backoff() {
        this.#poll_interval *= 2;
        if (this.#poll_interval > 300) {
            this.#poll_interval = 300;
        }
    }
    #undo_backoff() {
        this.#poll_interval /= 2;
        if (this.#poll_interval < this.#min_poll_interval) {
            this.#poll_interval = this.#min_poll_interval;
        }
    }
    #poll_timer;
    #start_poll() {
        const poll_func = async () => {
            if (this.#queue.shouldRun) {
                console.warn(`send queue is running, next poll in ${this.#poll_interval} sec`);
                this.#poll_timer = setTimeout(poll_func, this.#poll_interval * 1000);
                return;
            }
            try {
                const response = await axios.request({
                    method: 'get',
                    url: `http://${this.#ip}/messages`,
                    headers: { 'X-Requested-With': 'curl' },
                });
                const {status} = response;
                if (response?.data) {
                    this.#set_healthy(true);
                    const message = response.data;
                    try {
                        const guessed = ir_guess(response.data?.data);
                        this.emit('message', {message, guessed});
                    }
                    catch (guess_error) {
                        this.emit('message', {message});
                    }
                }
                this.#undo_backoff();

                // console.warn(`next poll in ${this.#poll_interval} sec`);
                this.#poll_timer = setTimeout(poll_func, this.#poll_interval * 1000);
            }
            catch (error) {
                this.#backoff();
                console.warn(`failed to get irkit messages : ${error} ; next poll in ${this.#poll_interval} sec`);
                this.#poll_timer =  setTimeout(poll_func, this.#poll_interval * 1000);
                this.#set_healthy(false);
            }
        };
        console.warn(`starting poll in ${this.#poll_interval} sec`);
        this.#poll_timer = setTimeout(poll_func, this.#poll_interval * 1000);
    }    
    stop_poll() {
        console.log('stop polling');
        if (this.#poll_timer) {
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
    #get_queue_ready(new_appliance_inst) {
        if (this.#sending_for_appliance_inst) {
            if (this.#sending_for_appliance_inst === new_appliance_inst) {
                console.warn('🐾 clear queue');
                this.#queue.clear();
                return true;
            }
            else {
                // this IrKit is currentl handling request for other appliances
                console.warn(`🐾 currently busy sending signals for ${this.#sending_for_appliance_inst.constructor.name}`);
                return false;
            }
        }  
        else {
            console.warn('🐾 start dealing with ' + new_appliance_inst.constructor.name);
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
    enqueue_single(single, appliance_inst) {
        if (! this.#get_queue_ready(appliance_inst)) {
            throw new Error('irkit is busy');
        }
        // console.log("enqueue: single", JSON.stringify(single));
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
    enqueue_multi(multi, appliance_inst) {
        if (! this.#get_queue_ready(appliance_inst)) {
            throw new Error('irkit is busy');
        }
        if (! Array.isArray(multi)) {
            throw new TypeError(`expecting multi to be Array instance, got :` + multi);
        }
        for (const m of multi) {
            const {sleep} = m;
            if (sleep) {
                const sleep_task = () => new Promise(resolve => {
                    console.log("sleep",sleep);
                    setTimeout(() => resolve(), sleep);
                });
                // console.log("enqueue: (multi) sleep task", sleep);
                this.#queue.enqueue(sleep_task);
            }
            else {
                // console.log("enqueue: (multi) regular task");
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
            // console.log("sleep",sleep);
            setTimeout(() => resolve(), sleep);
        });
        console.log("enqueue: sleep task", sleep);
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
        // console.log("enqueue: callback");
        this.#queue.enqueue(cb_task);        
        return this;
    }
    enqueue_done_callback(cb_function) {
        const cb_task = () => {
            return new Promise(resolve => {
                console.warn(`🐾 finished with ${this.#sending_for_appliance_inst.constructor.name}`);
                this.#sending_for_appliance_inst = null;
                cb_function();
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
    async #post_message(payload, timeout=5, retry=5){
        const axios_post = (url, payload, timeotu=5) => {
            return new Promise(async (resolve, reject) => {
                let timeoutTimer = setTimeout(()=>{ 
                    return reject({error: 'timeout'}); 
                }, timeout * 1000);
                try {
                    const res = await axios.request({
                        method: 'post',
                        url,
                        headers: { 'X-Requested-With': 'curl' },
                        data: JSON.stringify(payload),
                    });
                    console.log("post completed");
                    clearTimeout(timeoutTimer); 
                    this.#set_healthy(true);
                    return resolve(res);
                }
                catch (error) {
                    this.#set_healthy(false);
                    clearTimeout(timeoutTimer); 
                    console.warn(`post error : ${error}`);
                    return reject({error});
                }
            });
        };
        // console.log("irkit post_message", JSON.stringify(payload));
        this.#is_sending = true;
        let attempt = 0;
        let wait_delay = 3;
        while (true) {
            try {
                const response = await axios_post(`http://${this.#ip}/messages`, payload, timeout);
                this.#is_sending = false;
                return {done: response?.status === 200};
            }
            catch (error) {
                console.warn('failed to post irkit messages :' + JSON.stringify(error));
                if (retry && attempt < retry) {
                    attempt++;
                    console.warn('will retry', attempt, '/', retry, '; wait [sec]', wait_delay);
                    await sleep(wait_delay * 1000);
                    wait_delay *= 2;
                    continue;
                } 
                else {
                    this.#is_sending = false;
                    return {error};
                }
            }
        }
    }
    static is_irkit(ip) {
        return new Promise((resolve, reject) => {
            try {
                const response = axios.request({
                    method: 'get',
                    url: `http://${ip}`,
                    headers: { 'X-Requested-With': 'curl' },
                    validateStatus: (status) => status === 404,
                }).then(response => {
                    if ((response.headers?.server ?? '').match(/^IRKit\//)){
                        return resolve(true);
                    }
                    else {
                        console.warn(`${ip} did not respond with IRKit response header`);
                        return resolve(false);
                    }
                }).catch(error=> {
                    console.warn('axios error :',error);
                    return reject({error});
                });
            } catch (error) {
                console.warn('raised error :',error);
                return reject({error});
            }
        });
    }
}

module.exports = Irkit;
