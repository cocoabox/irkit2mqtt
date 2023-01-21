#!/usr/bin/env node

const {spawn} = require('child_process');
const fs = require('fs');

function exec(cmd, args) {
    return new Promise(function (resolve, reject) {
        if (! fs.existsSync(cmd)) {
            console.warn('🔥 cannot exec ; file not found :', cmd);
            return reject({error:'file-not-found'});
        }

        try {
            let stdout = '';
            let stderr = '';
            console.log(`> ${cmd} ${args.join(" ")}`);
            const child= spawn(cmd, args);

            child.stdout.setEncoding('utf8');
            child.stdout.on('data', (data) => {
                stdout+=data.toString();
            });
            child.stderr.setEncoding('utf8');
            child.stderr.on('data', (data) => {
                stderr+=data.toString();
            });
            child.on('close', (code) => { 
                console.log(`${cmd} ended with code ${code} ; stderr :`, stderr.trim());
                resolve({code, stdout, stderr});
            });
            child.on('error', function (error) {
                console.warn(`🔥 ${cmd} ${args.join(' ')} : execute error because`, error);
                reject({error, stdout, stderr});
            });
        }
        catch (error) {
            console.warn(`🔥 ${cmd} ${args.join(' ')} : UNCAUGHT EXCEPTION`, error);
            reject({error});
        }
    });
}


/**
 * @param {string} scan_target
 * @param {{nmap:string?}} opts
 * @return {Promise<{ips:string[],done:number}>}
 */
function nmap(scan_target, opts = {}) {
    opts = Object.assign({nmap: '/usr/bin/nmap', interface:''}, opts);
    return new Promise(async (resolve, reject)=> {
        const args =  [].concat(opts.interface ? ['-e', opts.interface] : [], 
            ['-n', '-sP', '-oG', '-', scan_target]);
        try {
        const res = await exec(opts.nmap, args);
        const {stdout, code} = res;
        const stdout_arr = stdout.split("\n");
        let ips = [];
        if (code=== 0) {
            stdout_arr.forEach(line => {
                console.log("[nmap says]", line);
                const match = line.match(/^Host: (.*?) \((.*?)\)\s+(Ports|Status):\s+(.*)$/);
                const ip = match?.[1];
                const label = match?.[3]?.toLowerCase();
                const status = match?.[4]?.toLowerCase();
                if (ip && ! ips.includes(ip) && label === 'status' && status === 'up') {
                    ips.push(ip);
                }
            });
            console.log("[nmap done] ", JSON.stringify(ips));
            resolve({done: 1, ips});
        }
        else {
            console.warn("[namp failed] status", status);
            reject({status});
        }
        } catch(nmap_err) {
            console.warn('[nmap failed] error', nmap_err);
            reject({error: nmap_err});
        }
    });
}


function arp(opts = {}) {
    opts = Object.assign({
        arp: '/usr/sbin/arp',
        interface: ''
    }, opts);

    return new Promise(async (resolve, reject) => {

        const {stdout, stderr, code} = await exec(opts.arp, 
            [].concat(['-na'], opts.interface? ['-i', opts.interface] : [])
        );
        if (code> 0) {
            console.log(`🔥 arp command failed ; says : ${stderr.trim()}`);
            return reject({error: 'arp-failed', stderr: stderr});
        }
        const stdout_arr = stdout.split('\n');
        let ip_mac_pairs = stdout_arr.map(line => {
            let mat = line.match(/^.*?\((.*?)\) at ([0-9,a-f,:]+)\s/);
            if (mat) {
                let this_ip = mat[1];
                let this_mac = mat[2].split(':')
                    .map(num => num.padStart(2, '0').toLowerCase())
                    .join(':');
                return {ip: this_ip, mac: this_mac};
            } else return null;
        }).filter(n => !!n);
        console.log('[arp found]', JSON.stringify(ip_mac_pairs));

        return resolve({done: 1, ip_mac_pairs});
    });
}

/**
 * discover hosts on some IP range, then report IP,MAC,Open Ports
 * @param {string} target   e.g. '192.168.1.1-100'
 * @return {Promise<{{done:number?,disovered:{ip:string,mac:string,open_ports:string[]}[]}>}
 */
function discover(target, opts={}) {
    opts = Object.assign({
        interface: '',
        nmap: '/usr/bin/nmap/',
    }, opts);

    return new Promise(async (resolve, reject) => {
        try {
            let {ips} = await nmap(target, {interface: opts.interface, nmap: opts.nmap});
            try {
                let {ip_mac_pairs} = await arp({interface: opts.interface});
                return resolve({done: 1, discovered: ip_mac_pairs.filter(imp => ips.includes(imp.ip))});
            } catch (error) {
                return reject({error: 'get-mac-error', get_mac_error: error});
            }

        } catch (error) {
            return reject({error: 'nmap-error', nmap_error: error});
        }
    });
}


module.exports = {discover, arp, nmap};


if (require.main === module) {
    let target = process.argv[2];
    if (!target) {
        console.warn(`usage : node ${process.argv[1]} <SCAN_TARGET>`);
        process.exit(1);
    }
    discover(target).then(n => console.log(JSON.stringify(n, "", 2))).catch(error => {
        console.warn("ERROR", error);
    });
}
