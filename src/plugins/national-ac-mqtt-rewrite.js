module.exports = {
    model : 'A75C3026' ,
    mqtt_rewrite : {
        // irkit2mqtt/DEVICE_NAME/ex/ha-mode             payload: true|false
        // irkit2mqtt/DEVICE_NAME/ex/ha-mode/set         payload: true|false
        // irkit2mqtt/DEVICE_NAME/ex/ha-mode/set/result  payload: ok|bad-request
        // ┏━━━━━━━━━━━━━━━━━━━━━━━━━━┛
        'ha-mode' : {
            mapped_state : (states) => {
                // convert internal "mode" value to something
                // HA understands
                if ( ! states.power ) return 'off';
                return states.mode;
            } ,
            get : 'string' ,
            set : (rcvd_val) => {
                console.log('received set ha-mode:' , rcvd_val);
                // received a message from HA, convert to nation-ac .state
                if ( rcvd_val === 'off' ) {
                    return {power : false};
                }
                if ( ['auto' , 'dry' , 'cool' , 'warm'].includes(rcvd_val) )
                    return {mode : rcvd_val};
                else throw new Error(`invalid mode received : ${rcvd_val}`);
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
            get : (strength , states) => {
                return {
                    quiet : 'quiet' ,
                    1 : 'low' ,
                    2 : 'medium-low' ,
                    3 : 'medium' ,
                    4 : 'high' ,
                    powerful : 'powerful' ,
                    auto : 'auto' ,
                }[strength];
            } ,
            set : (rcvd_val , states) => {
                return {
                    quiet : 'quiet' ,
                    low : 1 ,
                    'medium-low' : 2 ,
                    medium : 3 ,
                    high : 4 ,
                    powerful : 'powerful' ,
                    auto : 'auto'
                }[rcvd_val];
            } ,
        } ,
        'ha-swing-mode' : {
            // https://www.home-assistant.io/integrations/climate.mqtt/#swing_modes
            //
            mapped_state : 'direction' ,
            get : (direction , states) => {
                return {
                    1 : 'high' ,
                    2 : 'medium-high' ,
                    3 : 'medium' ,
                    4 : 'medium-low' ,
                    5 : 'low' ,
                    swing : 'swing' ,
                }[direction];
            } ,
            set : (rcvd_val , states) => {
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
