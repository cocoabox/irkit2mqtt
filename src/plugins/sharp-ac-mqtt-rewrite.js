module.exports = {
    model: 'A909JB',
    mqtt_rewrite: {
        // irkit2mqtt/DEVICE_NAME/ex/power             payload: true|false
        // irkit2mqtt/DEVICE_NAME/ex/power/set         payload: true|false
        // irkit2mqtt/DEVICE_NAME/ex/power/set/result  payload: ok|bad-request
        // ┏━━━━━━━━━━━━━━━━━━━━━━━━━━┛
        'ha-mode': {
            mapped_state: (states) => {
                // convert internal "mode" value to something 
                // HA understands
                if (! states.power) return 'off';
                const mode_val = states.mode;
                switch(mode_val) {
                    case 'dry':
                        return {
                            '-2': 'dry-2',
                            '-1': 'dry-1',
                            '0': 'dry',
                            '1': 'dry+1',
                            '2': 'dry+2',
                        }[states.temp];
                    case 'warm':
                        return 'heat';
                    case 'cool':
                    case 'ion': 
                    case 'indoor_drying': 
                        return mode_val;
                    default:
                        console.warn(`unknown internal mode ${mode_val} ; donno what to tell HA`);
                        return;
                }
            },
            get: 'string',
            set: (rcvd_val, current_states) => {
                console.log('received set ha-mode:', rcvd_val);
                // received a message from HA, convert to internal state
                if (rcvd_val === 'off') {
                    return {power:false};
                }
                const mode_str = {
                    cool: 'cool',
                    heat: 'warm',
                    ion: 'ion',
                    dry: 'dry',
                    'dry+2': 'dry',
                    'dry+1': 'dry',
                    'dry-1': 'dry',
                    'dry-2': 'dry',
                    indoor_drying: 'indoor_drying',
                }[rcvd_val];
                const mode = mode_str ? {mode: mode_str} : {};
                const temp_num = {
                    'dry+2': 2,
                    'dry+1': 1,
                    'dry-1': -1,
                    'dry-2': -2,
                }[rcvd_val];
                const temp = typeof temp_num === 'number' ? {temp: temp_num}: {};
                const out = Object.assign({power: true}, mode, temp);
                console.log('setting multiple states :', out);
                return out;
            },
        },
        'ha-temperature': {  
            mapped_state: 'temp',
            get: (temp_value, states) => {
                if (states.mode === 'dry') 
                    throw new Error('dry mode doesnt have temperature to report');
                return temp_value;
            },
            set: (rcvd_val, states) => {
                if (states.mode === 'dry') 
                    throw new Error('dry mode doesnt allow setting temperature');
                return rcvd_val;
            },
        },
        'ha-fan-mode': {
            mapped_state: 'strength',
            get: (strength, states) => {
                // console.log('🔹 strength =', strength);
                const out = {
                    1: 'low',
                    2: 'medium-low',
                    3: 'medium',
                    4: 'high',
                    auto: 'auto',
                }[strength];
                // console.log('🔸 (send) fan mode =', out);
                return out;
            },
            set: (rcvd_val, states) => {
                // console.log('🔸 (rcvd) fan mode =', rcvd_val);
                const out = {
                    low: 1,
                    'medium-low': 2,
                    medium:3,
                    high:4,
                    auto:'auto',
                }[rcvd_val];
                // console.log('🔹 converted to strength =', out);
                return out;
            },
        },
        'ha-swing-mode': {
            mapped_state: 'direction',
            get: (direction, states) => {
                // console.log('🔹 direction =', direction);
                const out = {
                    ceiling: 'ceiling',
                    1: 'high',
                    2: 'medium',
                    3: 'medium-low',
                    4: 'low',
                    auto: 'auto',
                    swing: 'swing',
                }[direction];
                // console.log('🔸 (send) swing mode =', out);
                return out;
            },
            set: (rcvd_val, states) => {
                // console.log('🔸 (rcvd) swing mode =', rcvd_val);
                const out = {
                    ceiling: 'ceiling',
                    high: 1,
                    medium: 2,
                    'medium-low': 3,
                    low: 4,
                    auto: 'auto',
                    swing: 'swing',
                }[rcvd_val];
                // console.log('🔹 converted to direction =', out);
                return out;
            },
        },
    },
};
