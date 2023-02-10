const axios = require('axios');

/**
 * makes an HTTP request using axios
 * @param {string} url
 * @param {number} [timeout=20] number of seconds until timeout rejection
 * @param {string} [method='get']
 * @param {string|Buffer} body POST/PUT request body
 * @param {number[]} allow_http_statuses list of HTTP status codes that are considered OK
 * @param {function?} log a log function : (...log_message) => {}
 * @param {function?} }warn a log-warn function : (...log_message) => {}
 * @returns {Promise<{body:string,status:number,headers:AxiosHeaders}>}
 */
function request(url , {timeout , method , body , allow_http_statuses , log , warn} = {}) {
    const do_log = typeof log === 'function' ? log : () => {
    };
    const do_warn = typeof warn === 'function' ? warn : () => {
    };
    return new Promise(async (resolve , reject) => {
        timeout = timeout ?? 20;
        const timeout_timer = timeout ?
            setTimeout(() => {
                do_warn('request :' , axios_request_opts , `timeout(${timeout} sec)`);
                reject({timeout : true});
            } , timeout * 1000) : null;

        const axios_request_opts = Object.assign({} ,
            {
                url , method ,
                headers : {'X-Requested-With' : 'curl'} ,
                transformResponse : (res) => res , // just everything in plain text
            } ,
            ['post' , 'put'].includes(method.toLowerCase()) && body ? {data : body} : {} ,
            allow_http_statuses ? {validateStatus : (status) => (Array.isArray(allow_http_statuses) ? allow_http_statuses : [allow_http_statuses]).includes(status)} : {} ,
        );
        try {
            const res = await axios.request(axios_request_opts);
            if ( timeout_timer ) clearTimeout(timeout_timer);
            const resolution = {
                body : res.data ,
                status : res.status ,
                headers : res.headers ,
            };
            do_log('request :' , axios_request_opts , '; received :' , resolution);
            return resolve(resolution);
        } catch (error) {
            do_warn('request :' , axios_request_opts , '; error :' , error);
            reject({error});
        }
    });
}

module.exports = request;
