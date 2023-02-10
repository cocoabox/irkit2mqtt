'use strict';

const EventEmitter = require('events');
const Irkit = require('./Irkit');

const springload_state_updated_sec = 5;

class IrkitAppliance extends EventEmitter {
    #irkit;
    #setup;
    #states;
    #log;

    constructor({irkit_inst , setup , restore_state_cache , log} = {}) {
        super();
        this.#log = log;

        if ( ! (irkit_inst instanceof Irkit) ) {
            throw new Error('expecting irkit_inst to be instance of Irkit, got :' + irkit_inst);
        }
        this.#irkit = irkit_inst;
        this.#setup = setup;
        this.#states = {};
        if ( restore_state_cache && typeof restore_state_cache === 'object' ) {
            this.#log(`[IrkitAppliance] restoring state cache to:` , restore_state_cache);
            this.set_states(restore_state_cache);
        } else {
            this.#log('[IrkitAppliance] nothing to restore');
        }
    }

    get log() {
        return this.#log;
    }

    get setup() {
        return this.#setup;
    }

    static get appliance_type() {
        // to be implemented by child
        throw new Error('appliance_type() is not implemented');
    }

    static get interface() {
        // to be implemented by child
        throw new Error('interface() is not implemented');
    }

    remove_invalid_states() {
        let removed_cnt = 0;
        for ( const [state_name , state_val] of Object.entries(this.#states) ) {
            try {
                const validate_res = this.#validate_state(state_name , state_val , this.#states);
                if ( validate_res === false ) {
                    this.#log.warn(`${this.constructor.name}.#states.${state_name} deemed invalid and will be removed :` , state_val);
                    delete this.#states[state_name];
                    ++removed_cnt;
                }
            } catch (error) {
                console.error(`🔥 while validating ${this.constructor.name}.#states.${state_name} ; value : ${state_val}, exception raised :` , error);
                delete this.#states[state_name];
                ++removed_cnt;
            }
        }
        if ( removed_cnt ) {
            this.#log.warn(`⚠️  validate_states() removed ${removed_cnt} invalid state values`);
        }
    }

    #validate_state(state_name , state_value , setting_states = null) {
        const rule = this.constructor.interface?.[state_name];
        if ( ! rule ) {
            this.#log.warn(`state is not defined :` , state_name);
            return false;
        }
        const {type , only , range , callback , null_ok} = rule;
        if ( null_ok && (state_value === null || typeof state_value === 'undefined') ) {
            return true;
        }
        const types = Array.isArray(type) ? type : [type];
        if ( ! types.includes(typeof state_value) ) {
            this.#log.warn(`validation failed : ${state_name} should be of type :` , types);
            return false;
        }
        if ( only ) {
            const onlys = Array.isArray(only) ? only : [only];
            if ( ! onlys.includes(state_value) && ! onlys.find(o =>
                o === state_value || o.toString() === state_value.toString()
            ) ) {
                this.#log.warn(`validation failed : ${state_name} should be either :` , onlys , ' got:' , state_value);
                return false;
            }
        }
        if ( range ) {
            const {min , max} = range;
            if ( state_value > max || state_value < min ) {
                this.#log.warn(`validation failed : ${state_name} should be within range (including) :` , {min , max});
                return false;
            }
        }
        if ( callback && typeof callback === 'function' ) {
            try {
                // let the callback see how the final states object will look like
                // so it can make the right decisions
                const combined_states = Object.assign({} , this.states , setting_states);
                if ( false === callback(state_value , combined_states) ) {
                    this.#log.warn(`validation failed : ${state_name} validation callback returned false`);
                    return false;
                }
            } catch (callback_error) {
                this.#log.warn(`validation failed : ${state_name} validation callback threw :` , callback_error.stack);
                return false;
            }
        }
        return true;
    }

    #state_updated_springload_timer;

    #state_updated_springload_timer_clear() {
        clearTimeout(this.#state_updated_springload_timer);
        this.#state_updated_springload_timer = null;
    }

    #state_updated_springload_timer_set(sec) {
        this.#state_updated_springload_timer = setTimeout(() => {
            this.emit('state-updated' , this.states);
        } , sec * 1000);
    }

    clear_states() {
        this.#states = {};
        this.#state_updated_springload_timer_clear();
        this.#state_updated_springload_timer_set(springload_state_updated_sec);
    }

    internal_set_state(state_name , state_value , setting_states = {}) {
        try {
            this.#states[state_name] = state_value;

            this.#state_updated_springload_timer_clear();
            this.#state_updated_springload_timer_set(springload_state_updated_sec);
            return true;
        } catch (error) {
            this.#log.warn('error while validating state :' , state_name , error.stack);
            return false;
        }
    }

    after_set_state() {
    }

    set_state(state_name , state_value) {
        if ( ! this.internal_set_state(state_name , state_value , {}) ) {
            return false;
        }
        this.after_set_state({[state_name] : state_value});
        return true;
    }

    set_states(state_name_value_pairs) {
        for ( const [state_name , state_value] of Object.entries(state_name_value_pairs) ) {
            this.#log('set' , state_name , '=>' , state_value);
            if ( ! this.internal_set_state(state_name , state_value , state_name_value_pairs) ) {
                this.#log.warn(`⚠️ failed to set ${state_name} =>` , state_value);
                return false;
            }
        }
        this.after_set_state(state_name_value_pairs);
        return true;
    }

    get_state(state_name , default_value = null) {
        return state_name in this.#states ?
            this.#states[state_name] : default_value;
    }

    get states() {
        return this.#states;
    }

    /**
     * generates a single/multi object for send() to submit to the IrKit
     * @protected
     * @return {{single:object}|{multi:Array}|
     */
    generate_irkit_data() {
        // to be implemented by child
        //
        // should return either :
        //      {single: IRKIT_DATA}
        // or:
        //      {multi: [IRKIT_DATA, {sleep:MSEC}, IRKIT_DATA, ...]}
        throw new Error('generate_irkit_data is not implemented');
    }

    /**
     * send all pending IRKit messages and resolves the promise when everything has been sent.
     * if the IrKit is busy processing requests from other appliances, there may be a short
     * delay before the promise is fulfilled
     * @param {object} o
     * @param {number} o.timeout_sec timeout in second
     * @return {Promise}
     */
    send({timeout_sec} = {}) {
        timeout_sec ??= 60;
        this.#log('💬 send() :' , JSON.stringify(this.states) , '⏱️ sec :' , timeout_sec);
        return new Promise((send_all_done , reje) => {
            let timeout_timer = setTimeout(() => {
                this.#log.warn('💬 🔥 send() timeout');
                reje({timeout : 1});
            } , timeout_sec * 1000);
            let irkit_data;
            try {
                irkit_data = this.generate_irkit_data();
                if ( ! irkit_data ) {
                    clearTimeout(timeout_timer);
                    this.#log.warn('generate_irkit_data() returned nothing');
                    throw new Error('empty irkit data returned from: generate_irkit_data()');
                }
            } catch (error) {
                this.#log.warn('💬⚠️ failed to generate irkit data because' , error.stack);
                clearTimeout(timeout_timer);
                return reje({error});
            }
            try {
                const {single , multi} = irkit_data;
                if ( single )
                    this.#irkit.enqueue_single(single , this);
                else if ( multi )
                    this.#irkit.enqueue_multi(multi , this);
            } catch (error) {
                clearTimeout(timeout_timer);
                this.#log.warn('💬⚠️ error eneuquing messages :' , error);
                return reje({error});
            }
            this.#irkit.enqueue_done_callback(() => {
                this.#log('💬 🟢 all send done');
                clearTimeout(timeout_timer);
                return send_all_done();
            });
        });
    }

    static get actions() {
        // to be implemented by child
        //
        // should return :
        //      {action_name: {args: [TYPE_NAME, TYPE_NAME, ...]}, ...}
        return {};
    }

    /**
     * performs an one-off action defined by the child class, for a list of available actions
     * see this.actions; returns Promise that fulfills when the IRKIit signal has been sent
     *
     * @param {string} action_name
     * @param {Array?} args
     */
    do_action(action_name , args = []) {
        this.#log(`🏃action "${action_name}" start`);
        return new Promise((send_all_done , reje) => {

            if ( ! (action_name in this.constructor.actions) ) {
                this.#log.warn(`no such action : ${action_name}; available :` ,
                    Object.keys(this.constructor.actions)
                );
                return reje({error : 'action-not-found'});
            }
            const arg_types = this.constructor.actions[action_name].args ?? [];
            // validate each arg
            for ( const [idx , rule] of arg_types.entries() ) {
                const arg_value = args[idx];
                this.#log(idx , rule , 'ARG_value=' , arg_value);
                if ( typeof rule === 'function' ) {
                    try {
                        if ( false === rule(arg_value) ) {
                            this.#log.warn(`callback validation on argument #${idx} failed :` , arg_value);
                            return reje({error : 'bad-args'});
                        }
                    } catch (err) {
                        this.#log.warn(`error while validating argument #${idx} : ${err} :` , arg_value);
                        return reje({error : 'bad-args'});
                    }
                } else if ( (typeof arg_value) !== rule ) {
                    this.#log.warn(`expecting argument #${idx} to be of type "${rule}" but got :` , arg_value , 'which is a' , typeof arg_value);
                    return reje({error : 'bad-args'});
                }
            }
            // call action func
            let irkit_data;
            try {
                irkit_data = this.action(action_name , args);
                this.#log('irkit_data =' , JSON.stringify(irkit_data));
            } catch (err) {
                this.#log.warn(`exception raised while doing action ${action_name} :` , err);
                return reje({error : 'do-action-exception'});
            }
            try {
                const {single , multi} = irkit_data;
                if ( single ) {
                    this.#irkit.enqueue_single(single , this);
                } else if ( multi ) {
                    this.#irkit.enqueue_multi(multi , this);
                }
                this.#irkit.enqueue_done_callback(() => {
                    this.#log(`🏃🟢 action "${action_name}" done`);
                    send_all_done();
                });
            } catch (error) {
                this.#log.warn('🏃🟢⚠️  action execution error :' , error);
                return reje({error : 'busy'});
            }
        });
    }

    incoming_signal({message , guessed}) {
        // to be sent to each child class when IRKit reads something
    }
}

module.exports = IrkitAppliance;
