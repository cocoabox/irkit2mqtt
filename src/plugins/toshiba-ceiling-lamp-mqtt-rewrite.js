const to255scale = (val, min, max) => {
    return Math.round((val-min) / (max-min) * 255);
};
const from255scale = (val255, min, max) => {
    return Math.round(val255 / 255 * (max - min) + min);
};

module.exports = {
    mqtt_rewrite: {
        // irkit2mqtt/DEVICE_NAME/ex/ha      topic for home assistant mqtt light entity
        // irkit2mqtt/DEVICE_NAME/ex/ha/set
        // ┏━━━━━━━━━━━━━━━━━━━━━━━━━┛
        ha: {
            mapped_state: function (states) {
                const self = this.appliance.constructor;
                const self_interface = self.interface;

                const all_modes = self_interface.mode.only;
                const current_mode = states.mode ?? 'normal';
                const ha_state = all_modes.includes(current_mode) 
                    && current_mode === 'off' ? 'OFF': 'ON';

                const {color_temp, brightness, mode, r, g, b} = states;
                const [bmin, bmax] = self.brightness_range(current_mode);

                const red = to255scale(r ?? 0, self.rgb_min, self.rgb_max);
                const green = to255scale(g ?? 0, self.rgb_min, self.rgb_max);
                const blue = to255scale(b ?? 0, self.rgb_min, self.rgb_max);

                return {
                    state: ha_state,
                    color_temp: to255scale(color_temp, self_interface.color_temp.range.min, 
                        self_interface.color_temp.range.max),
                    brightness: to255scale(brightness, bmin,bmax),
                    color: {
                        r: red,
                        g: green,
                        b: blue,
                    },
                };
            },
            get : 'json',
            set: function (user_obj, current_states) {
                const self = this.appliance.constructor;
                const self_interface = self.interface;

                if (typeof user_obj !== 'object') {
                    console.warn('mqtt_rewrite_plugin.ha.set() : expects object, got :', user_obj);
                    throw new Error('expecting JSON object for topic : ha/set');
                }
                let mode = current_states.mode;
                let mode_obj = mode ? {mode}:{mode:'normal'};
                const [bmin, bmax] = self.brightness_range(mode_obj.mode);
                const ctmin = self_interface.color_temp.range.min;
                const c_max = self_interface.color_temp.range.max;
                let {state, brightness, color_temp, color, color_mode} = user_obj;

                if (state === 'OFF') {
                    return {mode: 'off'};
                }
                else if (state === 'ON' && color) {
                    // convert HA 255scale rgb value to our RGB scale
                    let {r, g, b } = color;
                    return Object.assign({mode: 'normal'}, 
                        'brightness' in user_obj ?  {brightness: from255scale(brightness, bmin, bmax)}: {},
                        {
                            r : from255scale(r, self.rgb_min, self.rgb_max),
                            g : from255scale(g, self.rgb_min, self.rgb_max),
                            b : from255scale(b, self.rgb_min, self.rgb_max),
                        });
                }

                else if (state === 'ON' && 'brightness' in user_obj) {
                    return {brightness: from255scale(brightness, bmin, bmax)};
                }
                else if (state === 'ON' && Object.keys(user_obj).length === 1) {
                    return {mode: 'normal', brightness: bmax};
                }
                else {
                    console.warn('💔 couldnt understand HA input payload', user_obj);
                    return {};
                }
            },
        },
    },
    model: 'toshiba-frc205t',
};
