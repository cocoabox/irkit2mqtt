const Irkit = require('./Irkit');
const SharpAc = require('./plugins/sharp-ac').appliance_class;
const {exec} = require('child_process');

function sleep(msec) {
    return new Promise(resolve => setTimeout(() => resolve(), msec));
}
(async function() {
    try {
        const irkit = new Irkit('192.168.2.105');
        irkit.on('message', msg => {
            console.log('---> got :', JSON.stringify(msg));
        });
        if (process.env.LISTEN_ONLY==='yes') {
        console.log("==== LISTEN ONLY ===");
        }
        else {
        const ac = new SharpAc(irkit, {simple: true});
        
        console.log("==== TURN ON ===");
        let posi = '2';
        exec(`say 電源をON、風向を${posi}にします`);
        await ac.set_states({
            power: true,
            mode: 'warm',
            temp:20,
            direction: posi,
            strength: 1,
        }).send();

        await sleep(6*1000);

        posi = '4';
        console.log(`==== DIRECITON ${posi}===`);
        exec(`say 風向を${posi}にします`);
        await ac.set_states({
            direction: posi,
            strength: 4,
        }).send();
        await sleep(6*1000);

            /*
        console.log("==== TURN OFF===");
        exec(`say 電源を切ります`);
        await ac.set_states({
            power: false,
        }).send();
        await sleep(500);
        console.log("==== TURN OFF AGAIN ===");
        await ac.set_states({
            power: false,
        }).send();        
        */
        console.log("D O N E");
        }
        
    }
    catch (error) {
        console.warn('🔥 ', error.stack);
    }

})();
