module.exports = {
    model : 'A75C3026' ,
    mqtt_rewrite : {
        // irkit2mqtt/DEVICE_NAME/ex/ha-mode             payload: true|false
        // irkit2mqtt/DEVICE_NAME/ex/ha-mode/set         payload: true|false
        // irkit2mqtt/DEVICE_NAME/ex/ha-mode/set/result  payload: ok|bad-request
        // ┏━━━━━━━━━━━━━━━━━━━━━━━━━━┛
        'ha-mode' : {
            // https://www.home-assistant.io/integrations/climate.mqtt/#modes
            mapped_state : function (states) {
                // convert internal "mode" value to something
                // HA understands
                if ( ! states.power ) return 'off';
                return {
                    // national-ac mode : HA mode
                    auto : 'auto' ,
                    dry : 'dry' ,
                    cool : 'cool' ,
                    warm : 'heat' ,
                }[states.mode];
            } ,
            get : 'string' ,
            set : function (rcvd_val) {
                this.log('received set ha-mode:' , rcvd_val);
                // received a message from HA, convert to nation-ac .state
                if ( rcvd_val === 'off' ) {
                    return {power : false};
                }
                const national_ac_mode = {
                    dry : 'dry' ,
                    cool : 'cool' ,
                    heat : 'warm' ,
                    auto : 'auto' ,
                }[rcvd_val];
                if ( ! national_ac_mode ) {
                    throw new Error(`received invalid mode :${rcvd_val}`);
                }
                const national_ac_states = {mode : national_ac_mode , power : true};
                this.log('received set ha-mode:' , rcvd_val , '->' , national_ac_states);
                return national_ac_states;
            } ,
        } ,
        'ha-temperature' : {
            mapped_state : 'temp' ,
            get : (temp_value) => temp_value ,
            set : (rcvd_val) => rcvd_val ,
        } ,
        'ha-fan-mode' : {
            // https://www.home-assistant.io/integrations/climate.mqtt/#fan_modes
            // quiet,low,medium-low,medium,high,powerful,auto
            mapped_state : 'strength' ,
            get : function (strength , states) {
                const ha_fan_mode = {
                    quiet : 'quiet' ,
                    1 : 'low' ,
                    2 : 'medium-low' ,
                    3 : 'medium' ,
                    4 : 'high' ,
                    powerful : 'powerful' ,
                    auto : 'auto' ,
                }[strength];
                this.log('announcing ha-fan-mode:' , strength , '->' , ha_fan_mode);
                return ha_fan_mode;
            } ,
            set : function (rcvd_val , states) {
                const national_ac_strength = {
                    quiet : 'quiet' ,
                    low : 1 ,
                    'medium-low' : 2 ,
                    medium : 3 ,
                    high : 4 ,
                    powerful : 'powerful' ,
                    auto : 'auto'
                }[rcvd_val];
                this.log('received set ha-fan-mode:' , rcvd_val , '->' , national_ac_strength);
                return national_ac_strength;
            } ,
        } ,
        'ha-swing-mode' : {
            // https://www.home-assistant.io/integrations/climate.mqtt/#swing_modes
            mapped_state : 'direction' ,
            get : function (direction , states) {
                return {
                    1 : 'high' ,
                    2 : 'medium-high' ,
                    3 : 'medium' ,
                    4 : 'medium-low' ,
                    5 : 'low' ,
                    swing : 'swing' ,
                }[direction];
            } ,
            set : function (rcvd_val , states) {
                return {
                    high : 1 ,
                    'medium-high' : 2 ,
                    medium : 3 ,
                    'medium-low' : 4 ,
                    low : 5 ,
                    swing : 'swing'
                }[rcvd_val];
            } ,
        } ,
    } ,
};
