"use strict";

const EventEmitter = require("events");
const Irkit = require('./Irkit');

const springload_state_updated_sec = 5;

class IrkitAppliance extends EventEmitter {
    #irkit;
    #setup;
    #states;
    constructor(irkit_inst, setup) {
        super();

        if (! (irkit_inst instanceof Irkit)) {
            throw  new Error('expecting irkit_inst to be instance of Irkit, got :' + irkit_inst);
        }
        this.#irkit = irkit_inst
        this.#setup = setup;
        this.#states = {};
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
    #validate_state(state_name, state_value, setting_states=null) {
        const rule = this.constructor.interface?.[state_name];
        if (! rule) {
            console.warn(`state is not defined :`, state_name);
            return false;
        }
        const {type, only, range, callback, null_ok} = rule;
        if (null_ok && (state_value === null || typeof state_value === 'undefined')) {
            return true;
        }
        const types = Array.isArray(type) ? type : [type];
        if (! types.includes(typeof state_value)) {
            console.warn(`validation failed : ${state_name} should be of type :`, types);
            return false;
        }
        if (only) {
            const onlys = Array.isArray(only) ? only : [only];
            if (! onlys.includes(state_value) && ! onlys.find( o => 
                o === state_value || o.toString() === state_value.toString()
            )) {
                console.warn(`validation failed : ${state_name} should be either :`, onlys, ' got:', state_value);
                return false;
            }
        }
        if (range) {
            const {min, max} = range;
            if (state_value > max || state_value < min) {
                console.warn(`validation failed : ${state_name} should be within range (including) :`, {min, max});
                return false;
            }
        }
        if (callback && typeof callback === 'function') {
            try {
                // let the callback see how the final states object will look like
                // so it can make the right decisions
                const combined_states = Object.assign({}, this.states, setting_states);
                if (false === callback(state_value, combined_states)) {
                    console.warn(`validation failed : ${state_name} validation callback returned false`);
                    return false;
                }
            }
            catch (callback_error) {
                console.warn(`validation failed : ${state_name} validation callback threw :`, callback_error.stack);
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
            this.emit('state-updated', this.states);
        },sec * 1000);
    }
    
    clear_states() {
        this.#states = {};
        this.#state_updated_springload_timer_clear();
        this.#state_updated_springload_timer_set(springload_state_updated_sec);
    }

    internal_set_state(state_name, state_value, setting_states={}) {
        try {
            if (false === this.#validate_state(state_name, state_value, setting_states)) {
                console.warn('✘ failed to validate state :', state_name);
                return false;
            }
            this.#states[state_name] = state_value;
            
            this.#state_updated_springload_timer_clear();
            this.#state_updated_springload_timer_set(springload_state_updated_sec);
            return true;
        }
        catch (error) {
            console.warn('error while validating state :', state_name, error.stack);
            return false;
        }
    }

    after_set_state() {
    }

    set_state(state_name, state_value) {
        if (! this.internal_set_state(state_name, state_value, {})) {
            return false;
        }
        this.after_set_state();
        return true;
    }

    set_states(state_name_value_pairs) {
        for (const [state_name, state_value] of Object.entries(state_name_value_pairs)) {
            console.log('[set states]', state_name, state_value);
            if (! this.internal_set_state(state_name, state_value, state_name_value_pairs)) {
                return false;
            }
        }
        this.after_set_state();
        return true;
    }
    get_state(state_name, default_value=null) {
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
     * @return {Promise}
     */
    send() {
        console.log("💬 send() :", JSON.stringify(this.states));
        return new Promise((send_all_done, reje) => {
            let irkit_data;
            try {
                irkit_data = this.generate_irkit_data();
            }
            catch (error) {
                console.warn('failed to generate irkit data because', error.stack);
                reje({error});
                return;
            }
            if (! irkit_data) {
                throw new Error('failed to generate IRKit data');
            }
            const {single, multi} = irkit_data;
            if (single) {
                this.#irkit.enqueue_single(single);
            }
            else if (multi) {
                this.#irkit.enqueue_multi(multi);
            }
            this.#irkit.enqueue_callback(send_all_done);
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
    do_action(action_name, args=[]) {
        return new Promise((send_all_done, reje) => {

            if (! (action_name in this.constructor.actions)) {
                console.warn(`no such action : ${action_name}; available :`,
                    Object.keys(this.constructor.actions)
                );
                return reje({error: 'action-not-found'});
            }
            const arg_types = this.constructor.actions[action_name].args ?? [];
            // validate each arg
            for (const [idx, rule] of arg_types.entries()) {
                const arg_value = args[idx];
                console.log(idx, rule, "ARG_value=", arg_value);
                if( typeof rule === 'function' ) {
                    try {
                        if (false === rule(arg_value)) {
                            console.warn(`callback validation on argument #${idx} failed :`, arg_value);
                            return reje({error:'bad-args'});
                        }
                    }
                    catch (err) {
                        console.warn(`error while validating argument #${idx} : ${err} :`, arg_value);
                        return reje({error:'bad-args'});
                    }
                }
                else if ((typeof arg_value) !== rule) {
                    console.warn(`expecting argument #${idx} to be of type "${rule}" but got :`, arg_value, 'which is a', typeof arg_value);
                    return reje({error:'bad-args'});
                }
            }
            // call action func
            let irkit_data;
            try {
                irkit_data = this.action(action_name, args);
                console.log('irkit_data =', JSON.stringify(irkit_data));
            }
            catch (err) {
                console.warn(`exception raised while doing action ${action_name} :`, err);
                return reje({error: 'do-action-exception'});
            }
            const {single, multi} = irkit_data;
            if (single) {
                this.#irkit.enqueue_single(single);
            }
            else if (multi) {
                this.#irkit.enqueue_multi(multi);
            }
            this.#irkit.enqueue_callback(send_all_done);
        });
    }
}

module.exports = IrkitAppliance;
