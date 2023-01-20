const Irkit = require('./Irkit');
const ToshibaCeilingLamp = require('./plugins/toshiba-ceiling-lamp').appliance_class;

function sleep(msec) {
    return new Promise(resolve => setTimeout(() => resolve(), msec));
}
(async function() {
    try {
        const irkit = new Irkit('192.168.2.105');
        irkit.on('message', msg => {
            console.log('---> message :', msg);
        });
        const lamp = new ToshibaCeilingLamp(irkit, {ch:1});
        await lamp.set_states({
            mode: 'night-light',
            advanced: true,
            brightness: 1,
        }).send();

        console.log(lamp.states);
        await sleep(1000);
        await lamp.set_states({
            mode: 'normal',
            brightness: 0,
            r: 3,
            b: 5,
        }).send();

        console.log("D O N E");
        
    }
    catch (error) {
        console.warn('🔥 ', error.stack);
    }

})();
